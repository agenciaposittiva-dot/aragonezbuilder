import { and, eq, isNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { fileSrc } from "@/lib/design-doc";
import { findLibraryTemplate, TEMPLATE_LIBRARY, type PlaceholderSpec, type Placeholders } from "@/lib/template-library";
import { LIBRARY_THUMBNAILS } from "@/lib/template-library/thumbnails";
import { isPlatformAdmin } from "@/server/access-key";
import { can, type Actor, type Scope } from "@/server/authz";
import { designs } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createDesign } from "./designs";
import { storeUpload } from "./files";

/*
 * Biblioteca de modelos prontos: só a conta administradora da plataforma
 * (ARAGONEZ_ADMIN) vê e adiciona — sem ela configurada, a proprietária da
 * agência. Adicionar cria um template da agência (com imagens de exemplo em
 * Arquivos); a partir daí vale a regra normal de templates.
 */

export function canUseTemplateLibrary(actor: Actor): boolean {
  if (actor.kind !== "internal") return false;
  if (!can(actor, "templates.manage") || !can(actor, "designs.write") || !can(actor, "files.write")) return false;
  return env.ARAGONEZ_ADMIN ? isPlatformAdmin(actor.email) : actor.roleKey === "owner";
}

function assertLibraryAccess(actor: Actor) {
  if (!canUseTemplateLibrary(actor))
    throw new ForbiddenError("A biblioteca de modelos não está disponível para esta conta.");
}

const libraryKey = sql<string | null>`${designs.document}->'meta'->'library'->>'key'`;

/** Templates da agência já adicionados da biblioteca: chave → id do template. */
async function installed(s: Scope): Promise<Map<string, string>> {
  const rows = await s.db
    .select({ id: designs.id, key: libraryKey })
    .from(designs)
    .where(
      and(
        eq(designs.organizationId, s.actor.orgId),
        eq(designs.isTemplate, true),
        isNull(designs.deletedAt),
        isNull(designs.archivedAt),
        sql`${libraryKey} is not null`,
      ),
    );
  return new Map(rows.filter((r) => r.key).map((r) => [r.key!, r.id]));
}

export async function listTemplateLibrary(s: Scope) {
  if (!canUseTemplateLibrary(s.actor)) return null;
  const have = await installed(s);
  return TEMPLATE_LIBRARY.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    category: t.category,
    pages: t.pages,
    width: t.width,
    height: t.height,
    thumbnail: LIBRARY_THUMBNAILS[t.key] ?? null,
    installedId: have.get(t.key) ?? null,
  }));
}

/* ------------------------------------------------------------------ */
/* Imagens de exemplo                                                   */
/* ------------------------------------------------------------------ */

const ICON = (cx: number, cy: number, size: number, color: string) => {
  const s = size / 24;
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></g>`;
};

function placeholderSvg({ kind, width: w, height: h }: PlaceholderSpec): string {
  const svg = (defs: string, body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
  const min = Math.min(w, h);
  switch (kind) {
    case "photo-dusk":
      return svg(
        `<radialGradient id="g" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#6A7591"/><stop offset="0.55" stop-color="#36405A"/><stop offset="1" stop-color="#141925"/></radialGradient>`,
        `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
      );
    case "photo-night": {
      const cols = Array.from(
        { length: 9 },
        (_, i) => `<rect x="${i * 130 - 20}" y="0" width="70" height="${h}" fill="rgba(255,255,255,0.025)"/>`,
      ).join("");
      const rows = Array.from(
        { length: 14 },
        (_, i) => `<rect x="0" y="${i * 100 + 30}" width="${w}" height="8" fill="rgba(0,0,0,0.25)"/>`,
      ).join("");
      return svg(
        `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14302F"/><stop offset="1" stop-color="#050E0F"/></linearGradient><radialGradient id="l" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="rgba(255,190,110,0.55)"/><stop offset="1" stop-color="rgba(255,190,110,0)"/></radialGradient>`,
        `<rect width="${w}" height="${h}" fill="url(#g)"/>${cols}${rows}<rect x="${w * 0.47}" y="${h * 0.71}" width="${w * 0.12}" height="${h * 0.08}" fill="url(#l)"/>`,
      );
    }
    case "photo-light":
      return svg(
        `<radialGradient id="g" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#F4F4F4"/><stop offset="0.6" stop-color="#C9C9C9"/><stop offset="1" stop-color="#9E9E9E"/></radialGradient>`,
        `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
      );
    case "avatar":
      return svg(
        `<radialGradient id="g" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="#CDD1D7"/><stop offset="1" stop-color="#7B8290"/></radialGradient>`,
        `<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w / 2}" cy="${h * 0.4}" r="${min * 0.18}" fill="#EEF0F3"/><ellipse cx="${w / 2}" cy="${h * 0.95}" rx="${min * 0.34}" ry="${min * 0.26}" fill="#EEF0F3"/>`,
      );
    case "object":
      return svg(
        `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E2E2E2"/><stop offset="1" stop-color="#C8C8C8"/></linearGradient>`,
        `<rect width="${w}" height="${h}" fill="url(#g)"/>${ICON(w / 2, h / 2, min * 0.22, "#9C9C9C")}`,
      );
    case "block":
      return svg(
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E8262D"/><stop offset="1" stop-color="#B91C22"/></linearGradient>`,
        `<rect width="${w}" height="${h}" fill="url(#g)"/>${ICON(w / 2, h / 2, min * 0.28, "rgba(255,255,255,0.55)")}`,
      );
  }
}

export async function renderPlaceholder(spec: PlaceholderSpec): Promise<Buffer> {
  return sharp(Buffer.from(placeholderSvg(spec)))
    .jpeg({ quality: 86 })
    .toBuffer();
}

/* ------------------------------------------------------------------ */
/* Adicionar à agência                                                  */
/* ------------------------------------------------------------------ */

export async function installLibraryTemplate(s: Scope, key: string) {
  assertLibraryAccess(s.actor);
  const t = findLibraryTemplate(key);
  if (!t) throw new NotFoundError("Modelo não encontrado na biblioteca.");
  if ((await installed(s)).has(t.key)) {
    throw new ValidationError('Este modelo já está nos templates da agência. Use "Duplicar" para ter outra cópia.');
  }
  const srcs: Placeholders = {};
  for (const [name, spec] of Object.entries(t.placeholders)) {
    const stored = await storeUpload(
      s,
      { buffer: await renderPlaceholder(spec), originalName: `modelo-${t.key}-${name}.jpg` },
      {
        category: "template",
        tags: ["modelo", "biblioteca"],
        note: `Imagem de exemplo do modelo "${t.name}" (biblioteca de modelos). Troque pela imagem do cliente.`,
        source: "upload",
      },
    );
    srcs[name] = fileSrc(stored.versionId);
  }
  const doc = t.build(srcs);
  doc.meta = { ...doc.meta, library: { key: t.key, version: t.version } };
  const { id } = await createDesign(s, {
    name: t.name,
    width: t.width,
    height: t.height,
    isTemplate: true,
    templateCategory: t.category,
    document: doc as unknown as Record<string, unknown>,
  });
  const thumbnail = LIBRARY_THUMBNAILS[t.key];
  if (thumbnail) await s.db.update(designs).set({ thumbnail }).where(eq(designs.id, id));
  return { id };
}
