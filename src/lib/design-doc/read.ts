import { convertLegacyDocument, isLegacyDocument } from "./legacy";
import {
  DESIGN_SCHEMA,
  designComponentSchema,
  designDocumentSchema,
  designMetaSchema,
  designObjectSchema,
  documentIssues,
  guidesSchema,
  paintSchema,
  type DesignComponent,
  type DesignDocument,
  type DesignObject,
  type DesignPage,
} from "./schema";

export type ReadResult = {
  doc: DesignDocument;
  /** "v2" = já estava no formato novo; "fabric" = convertido do formato antigo; "repaired" = partes inválidas separadas. */
  source: "v2" | "fabric" | "repaired";
  /** Avisos legíveis (objetos guardados sem conversão exata, partes inválidas etc.). */
  notes: string[];
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Lê o documento salvo de uma arte em qualquer formato e devolve o formato 2.
 * Documentos antigos são convertidos na leitura (o banco só muda quando o
 * editor salva). Nunca lança: partes inválidas ficam guardadas em
 * `meta.legacy.invalid` para não se perderem.
 */
export function readDesignDocument(raw: unknown, size: { width: number; height: number }): ReadResult {
  if (isObj(raw) && raw.schema === DESIGN_SCHEMA) {
    const parsed = designDocumentSchema.safeParse(raw);
    if (parsed.success && !documentIssues(parsed.data).length) return { doc: parsed.data, source: "v2", notes: [] };
    return repair(raw, size);
  }
  if (isLegacyDocument(raw) || !isObj(raw)) {
    const { doc, passthrough, estimatedTexts } = convertLegacyDocument(raw, size);
    const notes: string[] = [];
    if (passthrough)
      notes.push(`${passthrough} elemento(s) do formato antigo mantido(s) como estavam (edição limitada).`);
    if (estimatedTexts) notes.push(`${estimatedTexts} texto(s) sem medida salva: ajustados ao abrir.`);
    return { doc, source: "fabric", notes };
  }
  return repair(raw, size);
}

/** Recupera o que for válido; o restante vai para `meta.legacy.invalid`. */
function repair(raw: Record<string, unknown>, size: { width: number; height: number }): ReadResult {
  const invalid: unknown[] = [];
  const ids = new Set<string>();
  const keepObjects = (list: unknown): DesignObject[] => {
    if (!Array.isArray(list)) return [];
    const out: DesignObject[] = [];
    for (const o of list) {
      const r = designObjectSchema.safeParse(o);
      if (r.success && !ids.has(r.data.id)) {
        ids.add(r.data.id);
        out.push(r.data);
      } else invalid.push(o);
    }
    return out;
  };
  const pages: DesignPage[] = [];
  for (const [i, p] of (Array.isArray(raw.pages) ? raw.pages : []).entries()) {
    if (!isObj(p)) continue;
    const w = Number(p.width);
    const h = Number(p.height);
    const bg = paintSchema.safeParse(p.background);
    const guides = guidesSchema.safeParse(p.guides);
    let id = typeof p.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.id) ? p.id : `page${i + 1}`;
    if (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    pages.push({
      id,
      name: typeof p.name === "string" ? p.name.slice(0, 80) : `Página ${i + 1}`,
      width: Number.isInteger(w) && w >= 16 && w <= 10_000 ? w : size.width,
      height: Number.isInteger(h) && h >= 16 && h <= 10_000 ? h : size.height,
      background: bg.success ? bg.data : "#ffffff",
      objects: keepObjects(p.objects),
      ...(guides.success ? { guides: guides.data } : {}),
    });
  }
  if (!pages.length) {
    pages.push({
      id: "p1",
      name: "Página 1",
      width: size.width,
      height: size.height,
      background: "#ffffff",
      objects: [],
    });
  }
  const components: DesignComponent[] = [];
  for (const c of Array.isArray(raw.components) ? raw.components : []) {
    const r = designComponentSchema.safeParse(c);
    if (r.success) components.push(r.data);
    else invalid.push(c);
  }
  const meta = designMetaSchema.safeParse(raw.meta);
  const doc: DesignDocument = {
    schema: DESIGN_SCHEMA,
    pages: pages.slice(0, 100),
    components,
    meta: {
      ...(meta.success ? meta.data : {}),
      ...(invalid.length ? { legacy: { ...(meta.success ? meta.data.legacy : {}), invalid } } : {}),
    },
  };
  // Instâncias de componentes que não existem mais viram inválidas também.
  const known = new Set(components.map((c) => c.id));
  const dropMissing = (list: DesignObject[]): DesignObject[] =>
    list
      .filter((o) => {
        if (o.type === "instance" && !known.has(o.componentId)) {
          invalid.push(o);
          return false;
        }
        return true;
      })
      .map((o) => (o.type === "group" ? { ...o, children: dropMissing(o.children) } : o));
  doc.pages = doc.pages.map((p) => ({ ...p, objects: dropMissing(p.objects) }));
  if (invalid.length) doc.meta = { ...doc.meta, legacy: { ...(doc.meta?.legacy ?? {}), invalid } };
  if (
    doc.meta?.carousel &&
    doc.pages.some((p) => p.width !== doc.pages[0]!.width || p.height !== doc.pages[0]!.height)
  ) {
    doc.meta = { ...doc.meta, carousel: false };
  }
  const notes = invalid.length
    ? [`${invalid.length} parte(s) inválida(s) do documento foram separadas e guardadas.`]
    : [];
  return { doc, source: "repaired", notes };
}
