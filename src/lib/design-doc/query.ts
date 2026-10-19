import { aabbOf, type Box } from "./geometry";
import type { DesignDocument, DesignObject, DesignObjectType, DesignPage, Paint } from "./schema";

/** Onde um objeto está: página (ou componente), grupo pai e posição na lista. */
export type ObjectLocation = {
  object: DesignObject;
  /** Página que contém o objeto (null quando está dentro de um componente). */
  pageId: string | null;
  componentId: string | null;
  /** Grupos do mais externo ao pai direto. */
  ancestors: string[];
  parentId: string | null;
  index: number;
};

function* walk(
  list: DesignObject[],
  owner: { pageId: string | null; componentId: string | null },
  ancestors: string[],
): Generator<ObjectLocation> {
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    yield { object: o, ...owner, ancestors, parentId: ancestors.at(-1) ?? null, index: i };
    if (o.type === "group") yield* walk(o.children, owner, [...ancestors, o.id]);
  }
}

/** Percorre todos os objetos (páginas e, opcionalmente, componentes), em ordem de camada. */
export function* allObjects(doc: DesignDocument, opts: { components?: boolean } = {}): Generator<ObjectLocation> {
  for (const p of doc.pages) yield* walk(p.objects, { pageId: p.id, componentId: null }, []);
  if (opts.components) for (const c of doc.components) yield* walk(c.objects, { pageId: null, componentId: c.id }, []);
}

export function locate(doc: DesignDocument, id: string): ObjectLocation | null {
  for (const loc of allObjects(doc, { components: true })) if (loc.object.id === id) return loc;
  return null;
}

export const findPageById = (doc: DesignDocument, id: string) => doc.pages.find((p) => p.id === id) ?? null;

/** Página por id, número (1 = primeira) ou nome. */
export function findPage(doc: DesignDocument, ref: string | number): DesignPage | null {
  if (typeof ref === "number") return doc.pages[ref - 1] ?? null;
  return (
    doc.pages.find((p) => p.id === ref) ??
    doc.pages.find((p) => p.name.toLocaleLowerCase("pt-BR") === ref.toLocaleLowerCase("pt-BR")) ??
    null
  );
}

export type ObjectQuery = {
  ids?: string[];
  /** Página por id ou número (1 = primeira). */
  page?: string | number;
  type?: DesignObjectType | DesignObjectType[];
  /** Nome exato da camada (sem diferenciar maiúsculas). */
  name?: string;
  /** Trecho do texto (sem diferenciar maiúsculas e acentos). */
  textContains?: string;
  includeHidden?: boolean;
  /** Incluir objetos dentro de grupos (padrão: sim). */
  nested?: boolean;
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** Busca objetos por id, página, tipo, nome ou texto. */
export function findObjects(doc: DesignDocument, q: ObjectQuery = {}): ObjectLocation[] {
  const page = q.page !== undefined ? findPage(doc, q.page) : null;
  if (q.page !== undefined && !page) return [];
  const types = q.type ? (Array.isArray(q.type) ? q.type : [q.type]) : null;
  const out: ObjectLocation[] = [];
  for (const loc of allObjects(doc)) {
    const o = loc.object;
    if (page && loc.pageId !== page.id) continue;
    if (q.nested === false && loc.ancestors.length) continue;
    if (!q.includeHidden && o.hidden) continue;
    if (q.ids && !q.ids.includes(o.id)) continue;
    if (types && !types.includes(o.type)) continue;
    if (q.name && fold(o.name) !== fold(q.name)) continue;
    if (q.textContains && !(o.type === "text" && fold(o.text).includes(fold(q.textContains)))) continue;
    out.push(loc);
  }
  return out;
}

/** Objetos de um grupo, recursivamente (os próprios grupos não entram). */
export function leavesOf(o: DesignObject): DesignObject[] {
  return o.type === "group" ? o.children.flatMap(leavesOf) : [o];
}

/** Arquivos (versões) usados pelas imagens do documento — a lista de assets. */
export function assetsOf(doc: DesignDocument): { src: string; objectIds: string[] }[] {
  const map = new Map<string, string[]>();
  const add = (src: string | undefined, id: string) => {
    if (!src) return;
    map.set(src, [...(map.get(src) ?? []), id]);
  };
  for (const loc of allObjects(doc, { components: true })) {
    const o = loc.object;
    if (o.type === "image") add(o.src, o.id);
    if (o.type === "instance") for (const ov of Object.values(o.overrides ?? {})) add(ov.src, o.id);
  }
  return [...map.entries()].map(([src, objectIds]) => ({ src, objectIds }));
}

/** Fontes usadas (para carregar antes de desenhar ou exportar). */
export function fontsOf(doc: DesignDocument): string[] {
  const set = new Set<string>();
  for (const loc of allObjects(doc, { components: true })) {
    if (loc.object.type === "text") set.add(loc.object.fontFamily);
  }
  for (const s of doc.styles?.text ?? []) set.add(s.fontFamily);
  return [...set];
}

/** Pesos de fonte usados por família (para carregar os pesos além de 400/700). */
export function fontWeightsOf(doc: DesignDocument): Record<string, number[]> {
  const out: Record<string, Set<number>> = {};
  const add = (family: string, weight: number) => (out[family] ??= new Set()).add(weight);
  for (const loc of allObjects(doc, { components: true })) {
    if (loc.object.type === "text") add(loc.object.fontFamily, loc.object.fontWeight);
  }
  for (const s of doc.styles?.text ?? []) add(s.fontFamily, s.fontWeight);
  return Object.fromEntries(Object.entries(out).map(([f, w]) => [f, [...w]]));
}

/** Cores sólidas usadas no documento, da mais frequente para a menos. */
export function colorsOf(doc: DesignDocument, pageId?: string): string[] {
  const freq = new Map<string, number>();
  const add = (p: Paint | null | undefined) => {
    if (!p) return;
    const list = typeof p === "string" ? [p] : p.stops.map((s) => s.color);
    for (const c of list) {
      const k = c.toLowerCase();
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  };
  for (const p of doc.pages) {
    if (pageId && p.id !== pageId) continue;
    add(p.background);
  }
  for (const loc of allObjects(doc)) {
    if (pageId && loc.pageId !== pageId) continue;
    const o = loc.object;
    if (o.type === "text") add(o.color);
    if ("fill" in o) add(o.fill as Paint | null);
    if ("stroke" in o) add(o.stroke as string | null);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Caixa que envolve vários objetos. */
export function boundsOf(objects: DesignObject[]): Box | null {
  if (!objects.length) return null;
  const boxes = objects.map(aabbOf);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const btm = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

const TYPE_LABEL: Record<DesignObjectType, string> = {
  text: "Texto",
  image: "Imagem",
  rect: "Retângulo",
  ellipse: "Elipse",
  triangle: "Triângulo",
  polygon: "Polígono",
  line: "Linha",
  path: "Desenho",
  group: "Grupo",
  instance: "Componente",
  fabric: "Elemento antigo",
};
export const typeLabel = (t: DesignObjectType) => TYPE_LABEL[t];

/** Nome curto e legível de um objeto (para diffs, histórico e o chat de IA). */
export function describeObject(o: DesignObject) {
  if (o.type === "text") {
    const t = o.text.replace(/\s+/g, " ").trim();
    return `${o.name || "Texto"} “${t.length > 40 ? `${t.slice(0, 40)}…` : t}”`;
  }
  return o.name || TYPE_LABEL[o.type];
}

/**
 * Resumo compacto do documento (páginas e objetos com as propriedades que
 * importam para editar) — base do contexto do chat de edição por IA.
 */
export function summarizeDocument(doc: DesignDocument) {
  const summarize = (o: DesignObject, depth: number): Record<string, unknown> => {
    const box = { x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.width), h: Math.round(o.height) };
    const out: Record<string, unknown> = { id: o.id, type: o.type, name: o.name, ...box };
    if (o.rotation) out.rotation = Math.round(o.rotation);
    if (o.hidden) out.hidden = true;
    if (o.locked) out.locked = true;
    if (o.opacity !== 1) out.opacity = o.opacity;
    if (o.type === "text") {
      Object.assign(out, {
        text: o.text,
        font: `${o.fontFamily} ${o.fontWeight}${o.fontStyle === "italic" ? " itálico" : ""}`,
        fontSize: o.fontSize,
        align: o.textAlign,
        color: o.color,
      });
    }
    if (o.type === "image") Object.assign(out, { src: o.src });
    if ("fill" in o && o.fill) out.fill = o.fill;
    if ("stroke" in o && o.stroke) out.stroke = o.stroke;
    if (o.type === "instance") out.componentId = o.componentId;
    if (o.type === "group" && depth < 4) out.children = o.children.map((c) => summarize(c, depth + 1));
    return out;
  };
  return {
    pages: doc.pages.map((p, i) => ({
      id: p.id,
      number: i + 1,
      name: p.name,
      size: `${p.width}×${p.height}`,
      background: p.background,
      objects: p.objects.map((o) => summarize(o, 0)),
    })),
    carousel: !!doc.meta?.carousel,
    components: doc.components.map((c) => ({ id: c.id, name: c.name })),
  };
}
