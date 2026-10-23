import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  assetFileId,
  contrastIssues,
  DEFAULT_PORTAL_SETTINGS,
  parsePortalSettings,
  portalAssetFileIds,
  portalSettingsSchema,
  PUBLIC_ASSET_KEYS,
  type PortalAssetKey,
  type PortalSettings,
} from "@/lib/portal-settings";
import { assertCan, assertClientAccess, assertInternal, can, fileScope, type Scope } from "@/server/authz";
import { withSystem, type Tx } from "@/server/db";
import {
  clientPortalSettings,
  clientPortalVersions,
  clients,
  files,
  fileVersions,
  organizations,
  user,
} from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { CLIENT_SLUG_RE, RESERVED_CLIENT_SLUGS } from "./client-slug";

/** Formatos aceitos nas imagens da marca (SVG fica de fora: pode conter scripts). */
export const PORTAL_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];

async function loadRow(tx: Tx, clientId: string) {
  const [row] = await tx.select().from(clientPortalSettings).where(eq(clientPortalSettings.clientId, clientId));
  return row ?? null;
}

async function ensureRow(s: Scope, clientId: string) {
  const row = await loadRow(s.db, clientId);
  if (row) return row;
  const [created] = await s.db
    .insert(clientPortalSettings)
    .values({ organizationId: s.actor.orgId, clientId, updatedByUserId: s.actor.userId })
    .returning();
  return created!;
}

/** Toda imagem referenciada precisa ser um arquivo de imagem deste cliente. */
async function assertAssets(s: Scope, clientId: string, settings: PortalSettings) {
  const ids = portalAssetFileIds(settings);
  if (!ids.length) return;
  const rows = await s.db
    .select({ id: files.id, clientId: files.clientId, mime: fileVersions.mimeType })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(and(inArray(files.id, ids), isNull(files.deletedAt)));
  for (const id of ids) {
    const f = rows.find((r) => r.id === id);
    if (!f || f.clientId !== clientId) throw new ValidationError("Use imagens enviadas para este cliente.");
    if (!PORTAL_IMAGE_MIMES.includes(f.mime)) throw new ValidationError("Use imagens PNG, JPEG ou WebP.");
  }
}

/* ------------------------------------------------------------------ */
/* Administração (equipe da agência)                                   */
/* ------------------------------------------------------------------ */

export async function getPortalAdmin(s: Scope, clientId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.read");
  await assertClientAccess(s, clientId);
  const [client] = await s.db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, logoFileId: clients.logoFileId })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client) throw new NotFoundError("Cliente não encontrado.");
  const row = await loadRow(s.db, clientId);
  const published = row?.published ? parsePortalSettings(row.published) : null;
  const draft = row?.draft ? parsePortalSettings(row.draft) : (published ?? DEFAULT_PORTAL_SETTINGS);
  const versions = await s.db
    .select({
      version: clientPortalVersions.version,
      createdAt: clientPortalVersions.createdAt,
      publishedByName: user.name,
    })
    .from(clientPortalVersions)
    .leftJoin(user, eq(user.id, clientPortalVersions.publishedByUserId))
    .where(eq(clientPortalVersions.clientId, clientId))
    .orderBy(desc(clientPortalVersions.version))
    .limit(20);
  return {
    client,
    draft,
    published,
    version: row?.version ?? 0,
    publishedAt: row?.publishedAt ?? null,
    loginEnabled: row?.loginEnabled ?? true,
    allowGuestInvites: row?.allowGuestInvites ?? false,
    hasUnpublishedChanges: !!row?.draft && JSON.stringify(draft) !== JSON.stringify(published),
    versions,
  };
}

export type PortalAdminView = Awaited<ReturnType<typeof getPortalAdmin>>;

/**
 * Imagens do cliente que podem ser usadas na personalização (PNG, JPEG ou
 * WebP). Alimenta o seletor de imagens e a prévia da equipe (links
 * autenticados /api/files/<versão>).
 */
export async function portalImageLibrary(s: Scope, clientId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.read");
  await assertClientAccess(s, clientId);
  if (!can(s.actor, "files.read")) return [];
  const rows = await s.db
    .select({
      id: files.id,
      name: files.name,
      category: files.category,
      versionId: fileVersions.id,
      mime: fileVersions.mimeType,
      width: fileVersions.width,
      height: fileVersions.height,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(
      and(
        fileScope(s.actor),
        eq(files.clientId, clientId),
        inArray(fileVersions.mimeType, PORTAL_IMAGE_MIMES),
        isNull(files.deletedAt),
      ),
    )
    .orderBy(desc(files.updatedAt))
    .limit(200);
  return rows;
}

export type PortalImage = Awaited<ReturnType<typeof portalImageLibrary>>[number];

export async function savePortalDraft(s: Scope, clientId: string, raw: z.input<typeof portalSettingsSchema>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, clientId);
  const settings = portalSettingsSchema.parse(raw);
  const issues = contrastIssues(settings);
  if (issues.length) {
    throw new ValidationError(issues[0]!.message, Object.fromEntries(issues.map((i) => [i.field, [i.message]])));
  }
  await assertAssets(s, clientId, settings);
  await ensureRow(s, clientId);
  await s.db
    .update(clientPortalSettings)
    .set({ draft: settings, updatedByUserId: s.actor.userId })
    .where(eq(clientPortalSettings.clientId, clientId));
  await recordActivity(s, {
    action: "portal_draft_saved",
    entityType: "client",
    entityId: clientId,
    summary: "Rascunho da personalização do portal salvo",
    event: false,
  });
  return settings;
}

/** Publica o rascunho: passa a valer no login e no portal do cliente. */
export async function publishPortal(s: Scope, clientId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, clientId);
  const row = await ensureRow(s, clientId);
  const settings = parsePortalSettings(row.draft ?? row.published ?? {});
  if (contrastIssues(settings).length) throw new ValidationError(contrastIssues(settings)[0]!.message);
  await assertAssets(s, clientId, settings);
  const version = row.version + 1;
  await s.db
    .update(clientPortalSettings)
    .set({
      published: settings,
      draft: settings,
      version,
      publishedAt: new Date(),
      publishedByUserId: s.actor.userId,
      updatedByUserId: s.actor.userId,
    })
    .where(eq(clientPortalSettings.clientId, clientId));
  await s.db.insert(clientPortalVersions).values({
    organizationId: s.actor.orgId,
    clientId,
    version,
    settings,
    publishedByUserId: s.actor.userId,
  });
  await recordActivity(s, {
    action: "portal_published",
    entityType: "client",
    entityId: clientId,
    summary: `Personalização do portal publicada (versão ${version})`,
    event: false,
  });
  return { version };
}

/** Volta o rascunho ao padrão da agência (ou a uma versão publicada anterior). */
export async function restorePortalDraft(s: Scope, clientId: string, fromVersion?: number) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, clientId);
  await ensureRow(s, clientId);
  let settings: PortalSettings = DEFAULT_PORTAL_SETTINGS;
  if (fromVersion) {
    const [v] = await s.db
      .select({ settings: clientPortalVersions.settings })
      .from(clientPortalVersions)
      .where(and(eq(clientPortalVersions.clientId, clientId), eq(clientPortalVersions.version, fromVersion)));
    if (!v) throw new NotFoundError("Versão não encontrada.");
    settings = parsePortalSettings(v.settings);
  }
  await s.db
    .update(clientPortalSettings)
    .set({ draft: settings, updatedByUserId: s.actor.userId })
    .where(eq(clientPortalSettings.clientId, clientId));
  await recordActivity(s, {
    action: "portal_draft_restored",
    entityType: "client",
    entityId: clientId,
    summary: fromVersion
      ? `Rascunho do portal restaurado da versão ${fromVersion}`
      : "Rascunho do portal restaurado ao padrão da agência",
    event: false,
  });
  return settings;
}

export const portalAccessInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Use pelo menos 2 caracteres")
    .max(48)
    .regex(CLIENT_SLUG_RE, "Use letras minúsculas, números e hífens"),
  loginEnabled: z.boolean(),
  allowGuestInvites: z.boolean(),
});

/** Endereço do portal, página de login própria e convites feitos pelo cliente. */
export async function updatePortalAccess(s: Scope, clientId: string, raw: z.input<typeof portalAccessInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, clientId);
  const data = portalAccessInput.parse(raw);
  if (RESERVED_CLIENT_SLUGS.has(data.slug)) {
    throw new ValidationError("Este endereço é reservado. Escolha outro.", { slug: ["Endereço reservado"] });
  }
  const [taken] = await s.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.slug, data.slug), eq(clients.organizationId, s.actor.orgId)));
  if (taken && taken.id !== clientId) {
    throw new ValidationError("Outro cliente já usa este endereço.", { slug: ["Endereço em uso"] });
  }
  await ensureRow(s, clientId);
  await s.db.update(clients).set({ slug: data.slug }).where(eq(clients.id, clientId));
  await s.db
    .update(clientPortalSettings)
    .set({
      loginEnabled: data.loginEnabled,
      allowGuestInvites: data.allowGuestInvites,
      updatedByUserId: s.actor.userId,
    })
    .where(eq(clientPortalSettings.clientId, clientId));
  await recordActivity(s, {
    action: "portal_access_updated",
    entityType: "client",
    entityId: clientId,
    summary: "Acesso ao portal atualizado",
    metadata: data,
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Portal (convidados)                                                 */
/* ------------------------------------------------------------------ */

/** Configuração publicada para o portal do cliente (padrão da agência se não houver). */
export async function getPublishedPortal(s: Scope, clientId: string) {
  await assertClientAccess(s, clientId);
  const row = await loadRow(s.db, clientId);
  return {
    settings: row?.published ? parsePortalSettings(row.published) : DEFAULT_PORTAL_SETTINGS,
    version: row?.version ?? 0,
    allowGuestInvites: row?.allowGuestInvites ?? false,
  };
}

/* ------------------------------------------------------------------ */
/* Acesso público (página de login do portal)                          */
/* ------------------------------------------------------------------ */

/**
 * Dados públicos do portal para a página de login: só o que foi publicado e
 * só se o login próprio estiver ativo. Não revela nada além da identidade
 * visual que a agência escolheu exibir.
 */
export async function resolvePublicPortal(orgSlug: string, clientSlug: string) {
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        orgId: organizations.id,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        orgLogoUrl: organizations.logoUrl,
        clientId: clients.id,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientLogoFileId: clients.logoFileId,
        published: clientPortalSettings.published,
        version: clientPortalSettings.version,
        loginEnabled: clientPortalSettings.loginEnabled,
      })
      .from(clients)
      .innerJoin(organizations, eq(organizations.id, clients.organizationId))
      .leftJoin(clientPortalSettings, eq(clientPortalSettings.clientId, clients.id))
      .where(
        and(
          eq(organizations.slug, orgSlug),
          eq(clients.slug, clientSlug),
          isNull(clients.archivedAt),
          isNull(clients.deletedAt),
          isNull(organizations.deletedAt),
        ),
      );
    if (!row) return null;
    const settings = row.published ? parsePortalSettings(row.published) : DEFAULT_PORTAL_SETTINGS;
    return {
      org: { id: row.orgId, name: row.orgName, slug: row.orgSlug, logoUrl: row.orgLogoUrl },
      client: { id: row.clientId, name: row.clientName, slug: row.clientSlug },
      settings,
      version: row.version ?? 0,
      loginEnabled: row.loginEnabled !== false,
      hasLogo: !!(settings.logoFileId || row.clientLogoFileId),
    };
  });
}

export type PublicPortal = NonNullable<Awaited<ReturnType<typeof resolvePublicPortal>>>;

/**
 * Localiza a imagem de marca de um portal. `draft` só é usado pela prévia da
 * equipe (a rota verifica a permissão). O logotipo cai no logotipo do cliente
 * cadastrado em Marca quando o portal não define um próprio.
 */
export async function resolvePortalAsset(clientId: string, key: PortalAssetKey, opts: { draft?: boolean } = {}) {
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        orgId: clients.organizationId,
        clientLogoFileId: clients.logoFileId,
        archivedAt: clients.archivedAt,
        deletedAt: clients.deletedAt,
        orgDeletedAt: organizations.deletedAt,
        draft: clientPortalSettings.draft,
        published: clientPortalSettings.published,
        loginEnabled: clientPortalSettings.loginEnabled,
      })
      .from(clients)
      .innerJoin(organizations, eq(organizations.id, clients.organizationId))
      .leftJoin(clientPortalSettings, eq(clientPortalSettings.clientId, clients.id))
      .where(eq(clients.id, clientId));
    // Cliente ou agência na lixeira: nenhuma imagem do portal é entregue.
    if (!row || row.deletedAt || row.orgDeletedAt) return null;
    const settings = parsePortalSettings(opts.draft ? (row.draft ?? row.published) : row.published);
    let fileId = assetFileId(settings, key);
    if (!fileId && key === "logo") fileId = row.clientLogoFileId;
    if (!fileId) return null;
    const [file] = await tx
      .select({
        clientId: files.clientId,
        versionId: fileVersions.id,
        storageKey: fileVersions.storageKey,
        mime: fileVersions.mimeType,
      })
      .from(files)
      .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
    if (!file || file.clientId !== clientId || !PORTAL_IMAGE_MIMES.includes(file.mime)) return null;
    return {
      orgId: row.orgId,
      versionId: file.versionId,
      storageKey: file.storageKey,
      mime: file.mime,
      public: PUBLIC_ASSET_KEYS.includes(key) && !opts.draft && row.loginEnabled !== false && !row.archivedAt,
    };
  });
}
