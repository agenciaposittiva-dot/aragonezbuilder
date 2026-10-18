import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { readDesignDocument, type DesignDocument } from "@/lib/design-doc";
import type { PortalPreview, PreviewData, PreviewOutput, PreviewSlide } from "@/lib/preview-data";
import { CONVERT_TARGETS, conversionProposalSchema, type ConvertTarget } from "@/lib/preview-convert";
import { isNetworkKey, isPlacementKey, NETWORK_KEYS, PLACEMENT_KEYS, SOCIAL_SPECS } from "@/lib/social-specs";
import { assertCan, assertInternal, can, clientScope, fileScope, type Scope } from "@/server/authz";
import { approvals, clients, contentItemAssets, contentItems, designs, files, fileVersions } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { diff, recordActivity } from "./activity";
import { requestApproval } from "./approvals";
import { brandForDesign, buildDesignDocument, getContent } from "./content";
import { createDesign, duplicateDesign, getDesign } from "./designs";

/*
 * Central de pré-visualização: monta, a partir dos registros que já existem
 * (peça de conteúdo, artes do editor salvas, arquivos exportados e
 * aprovações), os dados que a tela de prévia usa. Nada é copiado: a prévia
 * desenha as páginas a partir do último salvamento das artes.
 */

const UUID = z.uuid();

/* ------------------------------------------------------------------ */
/* Montagem                                                            */
/* ------------------------------------------------------------------ */

type DesignRow = {
  id: string;
  name: string;
  width: number;
  height: number;
  document: Record<string, unknown>;
  updatedAt: Date;
  outputFileId: string | null;
};

function pagesOf(rows: DesignRow[]) {
  return rows.map((d) => {
    const doc = readDesignDocument(d.document, { width: d.width, height: d.height }).doc;
    return { row: d, doc };
  });
}

function slidesFromDesigns(list: { row: DesignRow; doc: DesignDocument }[], format: string | null) {
  const total = list.reduce((n, d) => n + d.doc.pages.length, 0);
  const noun = format === "stories" || format === "reels" ? "Tela" : "Página";
  const slides: PreviewSlide[] = [];
  for (const { row, doc } of list) {
    doc.pages.forEach((p, i) => {
      slides.push({
        kind: "page",
        key: `${row.id}:${p.id}`,
        label: total > 1 ? `${noun} ${slides.length + 1}` : noun,
        designId: row.id,
        pageId: p.id,
        pageIndex: i,
        width: p.width,
        height: p.height,
      });
    });
  }
  return slides;
}

/** Arquivo exportado de cada página (formato novo) ou da arte inteira (formato antigo). */
function outputRefs(list: { row: DesignRow; doc: DesignDocument }[]) {
  const refs: { fileId: string; designId: string; pageId: string | null }[] = [];
  for (const { row, doc } of list) {
    const outputs = (doc.meta?.outputs ?? {}) as Record<string, string>;
    doc.pages.forEach((p, i) => {
      const fileId = outputs[p.id] ?? (i === 0 ? row.outputFileId : null);
      if (fileId && UUID.safeParse(fileId).success) refs.push({ fileId, designId: row.id, pageId: p.id });
    });
  }
  return refs;
}

async function loadOutputs(
  s: Scope,
  refs: { fileId: string; designId: string; pageId: string | null }[],
): Promise<PreviewOutput[]> {
  if (!refs.length) return [];
  const ids = [...new Set(refs.map((r) => r.fileId))];
  const rows = await s.db
    .select({
      id: files.id,
      name: files.name,
      status: files.status,
      sharedWithClient: files.sharedWithClient,
      versionId: files.currentVersionId,
      versionNumber: fileVersions.versionNumber,
      versionCreatedAt: fileVersions.createdAt,
    })
    .from(files)
    .leftJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(and(inArray(files.id, ids), fileScope(s.actor)));
  const versionIds = rows.map((r) => r.versionId).filter((v): v is string => !!v);
  const rounds = versionIds.length
    ? await s.db
        .select({ versionId: approvals.fileVersionId, stage: approvals.stage, status: approvals.status })
        .from(approvals)
        .where(inArray(approvals.fileVersionId, versionIds))
        .orderBy(desc(approvals.requestedAt))
    : [];
  const latest = (versionId: string | null, stage: string) =>
    rounds.find((r) => r.versionId === versionId && r.stage === stage)?.status ?? null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return refs.flatMap((ref) => {
    const f = byId.get(ref.fileId);
    if (!f) return [];
    return [
      {
        fileId: f.id,
        name: f.name,
        designId: ref.designId,
        pageId: ref.pageId,
        versionId: f.versionId,
        versionNumber: f.versionNumber ?? null,
        versionCreatedAt: f.versionCreatedAt ? f.versionCreatedAt.toISOString() : null,
        status: f.status,
        sharedWithClient: f.sharedWithClient,
        internal: latest(f.versionId, "internal"),
        client: latest(f.versionId, "client"),
      },
    ];
  });
}

/** Mais de 90 s entre a última exportação e o último salvamento da arte = exportação desatualizada. */
const STALE_MS = 90_000;

function exportsSummary(list: { row: DesignRow; doc: DesignDocument }[], outputs: PreviewOutput[]) {
  const total = list.reduce((n, d) => n + d.doc.pages.length, 0);
  if (!total) return null;
  const exportedPages = new Set(outputs.map((o) => `${o.designId}:${o.pageId}`));
  let stale = false;
  for (const { row } of list) {
    const times = outputs
      .filter((o) => o.designId === row.id && o.versionCreatedAt)
      .map((o) => new Date(o.versionCreatedAt!).getTime());
    if (times.length && row.updatedAt.getTime() - Math.max(...times) > STALE_MS) stale = true;
  }
  return { stale, exported: exportedPages.size, total };
}

async function clientInfo(s: Scope, clientId: string | null) {
  if (!clientId) return { client: null, logoVersions: [] as string[] };
  const [c] = await s.db
    .select({ id: clients.id, name: clients.name, logoFileId: clients.logoFileId })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!c) return { client: null, logoVersions: [] };
  let avatarUrl: string | null = null;
  let logoVersions: string[] = [];
  if (c.logoFileId) {
    const versions = await s.db
      .select({ id: fileVersions.id, current: files.currentVersionId })
      .from(fileVersions)
      .innerJoin(files, eq(files.id, fileVersions.fileId))
      .where(and(eq(fileVersions.fileId, c.logoFileId), fileScope(s.actor)));
    logoVersions = versions.map((v) => v.id);
    const current = versions.find((v) => v.id === v.current)?.id ?? null;
    avatarUrl = current ? `/api/files/${current}?thumb=1` : null;
  }
  return { client: { id: c.id, name: c.name, avatarUrl }, logoVersions };
}

function permissions(s: Scope) {
  return {
    writeContent: can(s.actor, "content.write"),
    writeDesign: can(s.actor, "designs.write"),
    requestApproval: can(s.actor, "approvals.request"),
    useAi: can(s.actor, "ai.use"),
  };
}

/** Prévia de uma peça de conteúdo (equipe interna). */
export async function getContentPreview(s: Scope, contentId: string): Promise<PreviewData> {
  const c = await getContent(s, contentId);
  const it = c.item;
  const designIds = c.assets.map((a) => a.designId).filter((x): x is string => !!x);
  const rows = designIds.length
    ? await s.db
        .select({
          id: designs.id,
          name: designs.name,
          width: designs.width,
          height: designs.height,
          document: designs.document,
          updatedAt: designs.updatedAt,
          outputFileId: designs.outputFileId,
        })
        .from(designs)
        .where(and(inArray(designs.id, designIds), isNull(designs.deletedAt)))
    : [];
  // Mesma ordem dos vínculos da peça.
  const ordered = designIds.flatMap((id) => rows.filter((r) => r.id === id).slice(0, 1));
  const list = pagesOf(ordered);
  let slides = slidesFromDesigns(list, it.format);
  if (!slides.length) {
    // Sem arte do editor: imagens ou vídeos anexados à peça viram as páginas.
    const fileIds = c.assets.map((a) => a.fileId).filter((x): x is string => !!x);
    if (fileIds.length) {
      const media = await s.db
        .select({
          id: files.id,
          name: files.name,
          versionId: files.currentVersionId,
          mimeType: fileVersions.mimeType,
          width: fileVersions.width,
          height: fileVersions.height,
        })
        .from(files)
        .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
        .where(and(inArray(files.id, fileIds), fileScope(s.actor)));
      slides = fileIds.flatMap((id, i) => {
        const f = media.find((m) => m.id === id);
        if (!f || !f.versionId) return [];
        return [
          {
            kind: "file" as const,
            key: `file:${f.id}`,
            label: fileIds.length > 1 ? `Mídia ${i + 1}` : f.name,
            fileId: f.id,
            versionId: f.versionId,
            mimeType: f.mimeType,
            width: f.width ?? 1080,
            height: f.height ?? 1080,
          },
        ];
      });
    }
  }
  const outputs = await loadOutputs(s, outputRefs(list));
  const { client, logoVersions } = await clientInfo(s, it.clientId);
  return {
    source: "content",
    content: {
      id: it.id,
      title: it.title,
      format: it.format,
      status: it.status,
      copy: it.copy,
      caption: it.caption,
      hashtags: it.hashtags,
      cta: it.cta,
      script: it.script,
      slides: it.slides,
      plannedDate: it.plannedDate,
      campaignName: c.campaignName,
      projectId: it.projectId,
      projectName: c.projectName,
      createdByName: c.createdByName,
      network: it.network,
      placement: it.placement,
    },
    design: null,
    client,
    designs: list.map(({ row, doc }) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt.toISOString(),
      carousel: !!doc.meta?.carousel,
      document: doc,
    })),
    slides,
    outputs,
    exports: exportsSummary(list, outputs),
    brandLogoVersionIds: logoVersions,
    permissions: permissions(s),
  };
}

/** Prévia de uma arte do Estúdio que não está ligada a uma peça (sem legenda). */
export async function getDesignPreview(s: Scope, designId: string): Promise<PreviewData> {
  const d = await getDesign(s, designId);
  const list = pagesOf([d.design]);
  const outputs = await loadOutputs(s, outputRefs(list));
  const { client, logoVersions } = await clientInfo(s, d.design.clientId);
  return {
    source: "design",
    content: null,
    design: { id: d.design.id, name: d.design.name },
    client,
    designs: list.map(({ row, doc }) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt.toISOString(),
      carousel: !!doc.meta?.carousel,
      document: doc,
    })),
    slides: slidesFromDesigns(list, null),
    outputs,
    exports: exportsSummary(list, outputs),
    brandLogoVersionIds: logoVersions,
    permissions: permissions(s),
  };
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function writeAccess(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "content.write");
}

export const previewTargetInput = z.object({
  contentId: z.uuid(),
  network: z.enum(NETWORK_KEYS),
  placement: z.enum(PLACEMENT_KEYS),
});

/** Guarda na peça a rede e o formato de destino escolhidos na prévia. */
export async function savePreviewTarget(s: Scope, raw: z.input<typeof previewTargetInput>) {
  writeAccess(s);
  const data = previewTargetInput.parse(raw);
  if (!SOCIAL_SPECS[data.network].placements[data.placement]) {
    throw new ValidationError(`${SOCIAL_SPECS[data.network].label} não tem este formato.`);
  }
  const c = await getContent(s, data.contentId);
  await s.db
    .update(contentItems)
    .set({ network: data.network, placement: data.placement, updatedByUserId: s.actor.userId })
    .where(eq(contentItems.id, c.item.id));
  await recordActivity(s, {
    action: "updated",
    entityType: "content",
    entityId: c.item.id,
    summary: `Destino da peça definido: ${data.network} (${data.placement})`,
    event: false,
  });
}

export const previewTextsInput = z.object({
  contentId: z.uuid(),
  caption: z.string().trim().max(4000).nullable(),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  cta: z.string().trim().max(300).nullable().optional(),
});

/** Legenda, hashtags e chamada revisadas na prévia (só esses campos; o resto da peça fica igual). */
export async function savePreviewTexts(s: Scope, raw: z.input<typeof previewTextsInput>) {
  writeAccess(s);
  const data = previewTextsInput.parse(raw);
  const c = await getContent(s, data.contentId);
  const patch: { caption: string | null; hashtags?: string[]; cta?: string | null } = { caption: data.caption || null };
  if (data.hashtags) patch.hashtags = data.hashtags;
  if (data.cta !== undefined) patch.cta = data.cta || null;
  await s.db
    .update(contentItems)
    .set({ ...patch, updatedByUserId: s.actor.userId })
    .where(eq(contentItems.id, c.item.id));
  await recordActivity(s, {
    action: "updated",
    entityType: "content",
    entityId: c.item.id,
    summary: `Legenda revisada na pré-visualização: ${c.item.title}`,
    changes: diff(
      { caption: c.item.caption, hashtags: c.item.hashtags, cta: c.item.cta },
      patch,
      Object.keys(patch) as ("caption" | "hashtags" | "cta")[],
    ),
    event: false,
  });
}

export const contentApprovalInput = z.object({
  contentId: z.uuid(),
  stage: z.enum(["internal", "client"]),
  message: z.string().trim().max(2000).optional().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

/**
 * Envia para aprovação (fluxo existente, por arquivo) todas as páginas
 * exportadas da peça. Páginas com pedido pendente na mesma etapa ficam como
 * estão. A peça passa para "Em revisão".
 */
export async function requestContentApproval(s: Scope, raw: z.input<typeof contentApprovalInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "approvals.request");
  const data = contentApprovalInput.parse(raw);
  const preview = await getContentPreview(s, data.contentId);
  const targets = preview.outputs.filter(
    (o) => o.versionId && (data.stage === "client" ? o.client : o.internal) !== "pending",
  );
  if (!preview.outputs.length) {
    throw new ValidationError("Exporte as páginas da arte para Arquivos antes de enviar para aprovação.");
  }
  if (!targets.length) throw new ValidationError("Todas as páginas já estão aguardando esta aprovação.");
  let requested = 0;
  const failures: string[] = [];
  for (const o of targets) {
    try {
      await requestApproval(s, {
        fileId: o.fileId,
        stage: data.stage,
        message: data.message ?? undefined,
        dueDate: data.dueDate ?? undefined,
      });
      requested++;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "Falha ao enviar.");
    }
  }
  if (!requested) throw new ValidationError(failures[0] ?? "Não foi possível enviar para aprovação.");
  if (["idea", "draft", "production"].includes(preview.content!.status)) {
    await s.db
      .update(contentItems)
      .set({ status: "review", updatedByUserId: s.actor.userId })
      .where(eq(contentItems.id, data.contentId));
  }
  return { requested, skipped: preview.outputs.length - requested, failures };
}

/** Duplica a peça (textos e artes); arquivos e imagens ligados são reaproveitados, sem cópia. */
export async function duplicateContent(s: Scope, contentId: string) {
  writeAccess(s);
  const c = await getContent(s, contentId);
  const it = c.item;
  const [row] = await s.db
    .insert(contentItems)
    .values({
      organizationId: s.actor.orgId,
      clientId: it.clientId,
      campaignId: it.campaignId,
      projectId: it.projectId,
      trendId: it.trendId,
      trendAnalysisId: it.trendAnalysisId,
      format: it.format,
      status: "draft",
      title: `${it.title} (cópia)`.slice(0, 200),
      concept: it.concept,
      strategy: it.strategy,
      copy: it.copy,
      caption: it.caption,
      cta: it.cta,
      script: it.script,
      visualDirection: it.visualDirection,
      imagePrompt: it.imagePrompt,
      hashtags: it.hashtags,
      slides: it.slides,
      network: it.network,
      placement: it.placement,
      createdByUserId: s.actor.userId,
      updatedByUserId: s.actor.userId,
    })
    .returning({ id: contentItems.id });
  for (const a of c.assets) {
    let designId: string | null = null;
    if (a.designId) {
      if (!can(s.actor, "designs.write")) continue;
      designId = (await duplicateDesign(s, a.designId)).id;
    }
    await s.db.insert(contentItemAssets).values({
      organizationId: s.actor.orgId,
      contentItemId: row!.id,
      designId,
      fileId: designId ? null : a.fileId,
      role: a.role,
      position: a.position,
    });
  }
  await recordActivity(s, {
    action: "created",
    entityType: "content",
    entityId: row!.id,
    summary: `Conteúdo duplicado de "${it.title}"`,
    event: false,
  });
  return { id: row!.id };
}

export const convertContentInput = conversionProposalSchema.extend({
  contentId: z.uuid(),
  target: z.enum(CONVERT_TARGETS),
});

const TARGET_SIZE: Record<ConvertTarget, { width: number; height: number; format: "carousel" | "stories" | "feed" }> = {
  carousel: { width: 1080, height: 1350, format: "carousel" },
  stories: { width: 1080, height: 1920, format: "stories" },
  feed: { width: 1080, height: 1350, format: "feed" },
};

/**
 * Cria uma peça NOVA no formato pedido, com artes editáveis novas a partir da
 * proposta aceita. A peça original não é alterada.
 */
export async function createConvertedContent(s: Scope, raw: z.input<typeof convertContentInput>) {
  writeAccess(s);
  assertCan(s.actor, "designs.write");
  const data = convertContentInput.parse(raw);
  const c = await getContent(s, data.contentId);
  const it = c.item;
  const size = TARGET_SIZE[data.target];
  // A imagem principal da peça (se houver) entra na capa da versão nova.
  const imageAsset = c.assets.find((a) => a.fileId && a.versionId);
  let image: { versionId: string; width: number; height: number } | null = null;
  if (imageAsset?.versionId) {
    const [v] = await s.db
      .select({
        id: fileVersions.id,
        width: fileVersions.width,
        height: fileVersions.height,
        mime: fileVersions.mimeType,
      })
      .from(fileVersions)
      .where(eq(fileVersions.id, imageAsset.versionId));
    if (v?.mime.startsWith("image/")) image = { versionId: v.id, width: v.width ?? 1024, height: v.height ?? 1024 };
  }
  const [row] = await s.db
    .insert(contentItems)
    .values({
      organizationId: s.actor.orgId,
      clientId: it.clientId,
      campaignId: it.campaignId,
      projectId: it.projectId,
      trendId: it.trendId,
      trendAnalysisId: it.trendAnalysisId,
      format: size.format,
      status: "draft",
      title: data.title,
      concept: it.concept,
      strategy: it.strategy,
      copy: data.slides[0]?.title || it.copy,
      caption: data.caption ?? it.caption,
      cta: data.cta ?? it.cta,
      visualDirection: it.visualDirection,
      imagePrompt: it.imagePrompt,
      hashtags: it.hashtags,
      slides: data.target === "feed" ? [] : data.slides,
      network: it.network,
      placement: data.target === "stories" ? "stories" : data.target === "carousel" ? "carousel" : "feed_portrait",
      createdByUserId: s.actor.userId,
      updatedByUserId: s.actor.userId,
    })
    .returning({ id: contentItems.id });
  const brand = await brandForDesign(s, it.clientId);
  const carousel = data.target === "carousel";
  const pages = (data.target === "feed" ? data.slides.slice(0, 1) : data.slides).map((sl, i) => ({
    texts: {
      headline: sl.title || data.title,
      body: sl.text || null,
      footer: i === data.slides.length - 1 && data.target !== "feed" ? (data.cta ?? null) : null,
    },
    image: i === 0 ? image : null,
  }));
  const { id: designId } = await createDesign(s, {
    name: `${data.title} — ${carousel ? "carrossel" : data.target === "stories" ? "stories" : "feed"}`.slice(0, 120),
    width: size.width,
    height: size.height,
    clientId: it.clientId,
    projectId: it.projectId,
    document: buildDesignDocument(size, pages, brand, { carousel }) as unknown as Record<string, unknown>,
  });
  await s.db.insert(contentItemAssets).values({
    organizationId: s.actor.orgId,
    contentItemId: row!.id,
    designId,
    role: size.format,
    position: 0,
  });
  if (imageAsset?.fileId) {
    await s.db.insert(contentItemAssets).values({
      organizationId: s.actor.orgId,
      contentItemId: row!.id,
      fileId: imageAsset.fileId,
      role: "image",
      position: 100,
    });
  }
  await recordActivity(s, {
    action: "created",
    entityType: "content",
    entityId: row!.id,
    summary: `Nova versão em ${size.format} criada a partir de "${it.title}" (a original foi mantida)`,
    event: false,
  });
  return { id: row!.id, designId };
}

/* ------------------------------------------------------------------ */
/* Ligações a partir de arquivos (aprovações) e portal do cliente      */
/* ------------------------------------------------------------------ */

/** Condição: a arte gerou este arquivo (página exportada ou arquivo principal). */
const designOutputs = (fileId: string) =>
  sql`(${designs.outputFileId} = ${fileId} or exists (select 1 from jsonb_each_text(coalesce(${designs.document}->'meta'->'outputs', '{}'::jsonb)) o where o.value = ${fileId}))`;

/** Peças cuja arte gerou o arquivo (para o atalho "Visualizar publicação" nas telas de arquivo). */
export async function contentsForFile(s: Scope, fileId: string) {
  if (!UUID.safeParse(fileId).success) return [];
  const rows = await s.db
    .selectDistinct({ id: contentItems.id, title: contentItems.title, clientId: contentItems.clientId })
    .from(contentItemAssets)
    .innerJoin(contentItems, eq(contentItems.id, contentItemAssets.contentItemId))
    .innerJoin(designs, eq(designs.id, contentItemAssets.designId))
    .where(
      and(
        isNull(designs.deletedAt),
        designOutputs(fileId),
        s.actor.kind === "client"
          ? inArray(contentItems.clientId, [...s.actor.clientIds, "00000000-0000-0000-0000-000000000000"])
          : inArray(contentItems.clientId, s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor))),
      ),
    )
    .limit(5);
  if (s.actor.kind !== "client" && !can(s.actor, "content.read")) return [];
  return rows.map((r) => ({ id: r.id, title: r.title }));
}

/** Peças de conteúdo que usam a arte (a prévia da arte leva para a da peça). */
export async function contentsForDesign(s: Scope, designId: string) {
  assertInternal(s.actor);
  if (!can(s.actor, "content.read") || !UUID.safeParse(designId).success) return [];
  return s.db
    .selectDistinct({ id: contentItems.id, title: contentItems.title })
    .from(contentItemAssets)
    .innerJoin(contentItems, eq(contentItems.id, contentItemAssets.contentItemId))
    .where(
      and(
        eq(contentItemAssets.designId, designId),
        inArray(contentItems.clientId, s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor))),
      ),
    )
    .limit(10);
}

/**
 * Prévia para o cliente: só as páginas exportadas que já foram compartilhadas
 * com ele (as mesmas que aparecem em Materiais), com a legenda da peça. Sem
 * nada compartilhado, a peça não existe para o portal.
 */
export async function getPortalPreview(s: Scope, contentId: string): Promise<PortalPreview> {
  if (s.actor.kind !== "client") throw new ForbiddenError();
  if (!UUID.safeParse(contentId).success) throw new NotFoundError("Prévia não encontrada.");
  if (!s.actor.permissions.has("files.read")) throw new NotFoundError("Prévia não encontrada.");
  const [it] = await s.db
    .select({ item: contentItems, clientName: clients.name })
    .from(contentItems)
    .innerJoin(clients, eq(clients.id, contentItems.clientId))
    .where(
      and(
        eq(contentItems.id, contentId),
        inArray(contentItems.clientId, [...s.actor.clientIds]),
        isNull(clients.deletedAt),
      ),
    );
  if (!it) throw new NotFoundError("Prévia não encontrada.");
  const rows = await s.db
    .select({
      id: designs.id,
      name: designs.name,
      width: designs.width,
      height: designs.height,
      document: designs.document,
      updatedAt: designs.updatedAt,
      outputFileId: designs.outputFileId,
    })
    .from(contentItemAssets)
    .innerJoin(designs, eq(designs.id, contentItemAssets.designId))
    .where(and(eq(contentItemAssets.contentItemId, contentId), isNull(designs.deletedAt)))
    .orderBy(asc(contentItemAssets.position));
  const refs = outputRefs(pagesOf(rows));
  const ids = [...new Set(refs.map((r) => r.fileId))];
  const visible = ids.length
    ? await s.db
        .select({
          id: files.id,
          name: files.name,
          versionId: files.currentVersionId,
          versionNumber: fileVersions.versionNumber,
          mimeType: fileVersions.mimeType,
          width: fileVersions.width,
          height: fileVersions.height,
        })
        .from(files)
        .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
        .where(and(inArray(files.id, ids), fileScope(s.actor)))
    : [];
  const slides = refs.flatMap((r, i) => {
    const f = visible.find((v) => v.id === r.fileId);
    if (!f || !f.versionId) return [];
    return [
      {
        kind: "file" as const,
        key: `file:${f.id}:${i}`,
        label: refs.length > 1 ? `Página ${i + 1}` : f.name,
        fileId: f.id,
        versionId: f.versionId,
        mimeType: f.mimeType,
        width: f.width ?? 1080,
        height: f.height ?? 1350,
      },
    ];
  });
  if (!slides.length) throw new NotFoundError("Prévia não encontrada.");
  const c = it.item;
  return {
    content: {
      id: c.id,
      title: c.title,
      format: c.format,
      caption: c.caption,
      hashtags: c.hashtags,
      cta: c.cta,
      network: isNetworkKey(c.network) ? c.network : "instagram",
      placement: isPlacementKey(c.placement) ? c.placement : null,
      plannedDate: c.plannedDate,
    },
    client: { name: it.clientName },
    slides,
    versions: Object.fromEntries(
      visible.flatMap((v) => (v.versionId ? [[v.id, { id: v.versionId, versionNumber: v.versionNumber }]] : [])),
    ),
  };
}
