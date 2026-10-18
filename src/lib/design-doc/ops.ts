import { z } from "zod";
import {
  aabbOf,
  centerOf,
  rotateObject,
  scaleObject,
  setObjectBox,
  translateObject,
  unionBoxes,
  withGroupBox,
} from "./geometry";
import { newId as randomId } from "./ids";
import { describeObject, locate, type ObjectLocation } from "./query";
import {
  colorSchema,
  designComponentSchema,
  designMetaSchema,
  designObjectSchema,
  designPageSchema,
  documentIssues,
  guidesSchema,
  idSchema,
  paintSchema,
  shadowSchema,
  type Crop,
  type DesignComponent,
  type DesignDocument,
  type DesignObject,
  type DesignPage,
  type GroupObject,
  type ImageObject,
  type InstanceObject,
  type InstanceOverride,
  type Paint,
} from "./schema";

/*
 * Camada de operações do documento (pura, sem React nem Fabric).
 *
 * Toda alteração — do editor, do servidor ou do futuro chat de edição por IA —
 * é uma lista de operações. Cada operação é validada, devolve um diff legível
 * (antes/depois) e a inversa exata para desfazer. Um lote é atômico: se uma
 * operação falhar, nada é aplicado.
 *
 *   const r = applyOperations(doc, [{ op: "setText", id: "t1", text: "Oferta" }]);
 *   r.doc       // documento novo (objetos não alterados mantêm a mesma referência)
 *   r.diffs     // [{ summary: "Título: texto “Antes” → “Oferta”", changes: [...] }]
 *   r.inverse   // operações que desfazem o lote
 *   r.applied   // operações efetivamente aplicadas (ids gerados preenchidos — use para refazer)
 */

/* ------------------------------------------------------------------ */
/* Esquema das operações                                               */
/* ------------------------------------------------------------------ */

const finite = z.number().refine(Number.isFinite, "Número inválido");
const ids = z.array(idSchema).min(1).max(2000);
const idMap = z.record(idSchema, idSchema);

export const stylePatchSchema = z
  .object({
    fill: paintSchema.nullable(),
    color: paintSchema,
    stroke: colorSchema.nullable(),
    strokeWidth: z.number().min(0).max(10_000),
    strokeDash: z.array(z.number().min(0).max(10_000)).max(16).nullable(),
    radius: z.number().min(0).max(1_000_000),
    opacity: z.number().min(0).max(1),
    shadow: shadowSchema.nullable(),
    fontFamily: z.string().min(1).max(80),
    fontSize: z.number().min(1).max(5000),
    fontWeight: z.number().int().min(100).max(1000),
    fontStyle: z.enum(["normal", "italic"]),
    textAlign: z.enum(["left", "center", "right", "justify"]),
    lineHeight: z.number().min(0.3).max(10),
    letterSpacing: z.number().min(-1000).max(10_000),
    underline: z.boolean(),
    linethrough: z.boolean(),
    background: colorSchema.nullable(),
    lineCap: z.enum(["butt", "round", "square"]),
  })
  .partial();
export type StylePatch = z.infer<typeof stylePatchSchema>;

const container = {
  pageId: idSchema.optional(),
  componentId: idSchema.optional(),
  parentId: idSchema.nullable().optional(),
};

const overridePatch = z
  .object({
    text: z.string().max(20_000),
    src: z.string().max(8_000_000),
    color: paintSchema,
    fill: paintSchema.nullable(),
    hidden: z.boolean(),
  })
  .partial();

export const designOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    object: designObjectSchema,
    index: z.number().int().min(0).optional(),
    ...container,
  }),
  z.object({ op: z.literal("remove"), ids }),
  z.object({
    op: z.literal("update"),
    id: idSchema,
    set: z.record(z.string(), z.unknown()),
    unset: z.array(z.string()).max(40).optional(),
  }),
  z.object({ op: z.literal("replace"), id: idSchema, object: designObjectSchema }),
  z.object({ op: z.literal("setText"), id: idSchema, text: z.string().max(20_000) }),
  z.object({ op: z.literal("setStyle"), ids, style: stylePatchSchema }),
  z.object({
    op: z.literal("transform"),
    id: idSchema,
    x: finite.optional(),
    y: finite.optional(),
    width: z.number().min(0).max(1_000_000).optional(),
    height: z.number().min(0).max(1_000_000).optional(),
    rotation: finite.optional(),
  }),
  z.object({ op: z.literal("move"), ids, dx: finite, dy: finite }),
  z.object({
    op: z.literal("resize"),
    ids,
    scaleX: z.number().positive().max(1000),
    scaleY: z.number().positive().max(1000),
    originX: finite.optional(),
    originY: finite.optional(),
  }),
  z.object({
    op: z.literal("replaceImage"),
    id: idSchema,
    src: z.string().min(1).max(8_000_000),
    naturalWidth: z.number().positive().max(100_000),
    naturalHeight: z.number().positive().max(100_000),
    fit: z.enum(["fill", "fit", "stretch"]).optional(),
  }),
  z.object({
    op: z.literal("imageFit"),
    id: idSchema,
    mode: z.enum(["fill", "fit", "stretch"]),
    zoom: z.number().min(1).max(20).optional(),
    focusX: z.number().min(0).max(1).optional(),
    focusY: z.number().min(0).max(1).optional(),
  }),
  z.object({
    op: z.literal("crop"),
    id: idSchema,
    crop: z.object({ x: finite, y: finite, width: z.number().positive(), height: z.number().positive() }).nullable(),
  }),
  z.object({ op: z.literal("duplicate"), ids, dx: finite.optional(), dy: finite.optional(), idMap: idMap.optional() }),
  z.object({
    op: z.literal("reorder"),
    id: idSchema,
    to: z.union([z.enum(["front", "back", "forward", "backward"]), z.number().int().min(0)]),
  }),
  z.object({ op: z.literal("reparent"), id: idSchema, index: z.number().int().min(0).optional(), ...container }),
  z.object({ op: z.literal("group"), ids, groupId: idSchema.optional(), name: z.string().max(120).optional() }),
  z.object({ op: z.literal("ungroup"), id: idSchema }),
  z.object({
    op: z.literal("restoreList"),
    objects: z.array(designObjectSchema).max(2000),
    ...container,
  }),
  z.object({
    op: z.literal("align"),
    ids,
    edge: z.enum(["left", "hcenter", "right", "top", "vcenter", "bottom"]),
    to: z.enum(["selection", "page"]).optional(),
  }),
  z.object({ op: z.literal("distribute"), ids, axis: z.enum(["horizontal", "vertical"]) }),
  z.object({ op: z.literal("addPage"), page: designPageSchema, index: z.number().int().min(0).optional() }),
  z.object({ op: z.literal("removePage"), id: idSchema }),
  z.object({
    op: z.literal("updatePage"),
    id: idSchema,
    set: z
      .object({
        name: z.string().max(80),
        width: z.number().int().min(16).max(10_000),
        height: z.number().int().min(16).max(10_000),
        background: paintSchema,
        guides: guidesSchema,
      })
      .partial(),
  }),
  z.object({ op: z.literal("replacePage"), page: designPageSchema }),
  z.object({ op: z.literal("reorderPage"), id: idSchema, index: z.number().int().min(0) }),
  z.object({
    op: z.literal("duplicatePage"),
    id: idSchema,
    newPageId: idSchema.optional(),
    idMap: idMap.optional(),
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal("changePalette"),
    map: z
      .array(z.object({ from: colorSchema, to: colorSchema }))
      .min(1)
      .max(40),
    pageId: idSchema.optional(),
  }),
  z.object({
    op: z.literal("setMeta"),
    set: z
      .object({
        carousel: z.boolean(),
        preset: z.string().max(60).nullable(),
        outputs: z.record(idSchema, z.uuid()),
        pdfOutputFileId: z.uuid().nullable(),
      })
      .partial(),
  }),
  z.object({ op: z.literal("replaceMeta"), meta: designMetaSchema.nullable() }),
  z.object({
    op: z.literal("addComponent"),
    component: designComponentSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal("removeComponent"), id: idSchema }),
  z.object({ op: z.literal("replaceComponent"), component: designComponentSchema }),
  z.object({
    op: z.literal("createComponent"),
    ids,
    componentId: idSchema.optional(),
    instanceId: idSchema.optional(),
    name: z.string().max(120).optional(),
  }),
  z.object({ op: z.literal("detachInstance"), id: idSchema, idMap: idMap.optional() }),
  z.object({ op: z.literal("overrideInstance"), id: idSchema, childId: idSchema, set: overridePatch.nullable() }),
  z.object({
    op: z.literal("setStyles"),
    styles: z
      .object({
        colors: z
          .array(z.object({ id: idSchema, name: z.string().max(80), value: colorSchema }))
          .max(200)
          .optional(),
        text: z
          .array(
            z.object({
              id: idSchema,
              name: z.string().max(80),
              fontFamily: z.string().min(1).max(80),
              fontSize: z.number().min(1).max(5000),
              fontWeight: z.number().int().min(100).max(1000),
              lineHeight: z.number().min(0.3).max(10),
              letterSpacing: z.number().min(-1000).max(10_000),
              color: paintSchema,
            }),
          )
          .max(200)
          .optional(),
      })
      .nullable(),
  }),
]);

export type DesignOp = z.infer<typeof designOpSchema>;
export type DesignOpName = DesignOp["op"];

/* ------------------------------------------------------------------ */
/* Resultado                                                           */
/* ------------------------------------------------------------------ */

export type FieldChange = { id: string; field: string; before: unknown; after: unknown };
export type OpTarget = {
  kind: "object" | "page" | "component" | "document";
  id: string;
  label: string;
  pageId?: string | null;
};
export type OpDiff = { op: DesignOpName; summary: string; targets: OpTarget[]; changes: FieldChange[] };

export type ApplyResult = {
  doc: DesignDocument;
  diffs: OpDiff[];
  inverse: DesignOp[];
  applied: DesignOp[];
};

export class DesignOpError extends Error {
  constructor(
    message: string,
    readonly index: number,
    readonly op?: string,
  ) {
    super(message);
    this.name = "DesignOpError";
  }
}

type Ctx = { newId: () => string; index: number };
type Step = { doc: DesignDocument; inverse: DesignOp[]; applied: DesignOp; diff: OpDiff };

const fail = (ctx: Ctx, message: string): never => {
  throw new DesignOpError(message, ctx.index);
};

/* ------------------------------------------------------------------ */
/* Diffs legíveis                                                      */
/* ------------------------------------------------------------------ */

const FIELD_LABEL: Record<string, string> = {
  text: "texto",
  name: "nome",
  x: "posição X",
  y: "posição Y",
  width: "largura",
  height: "altura",
  rotation: "rotação",
  opacity: "opacidade",
  locked: "bloqueio",
  hidden: "oculto",
  fill: "preenchimento",
  color: "cor do texto",
  stroke: "contorno",
  strokeWidth: "espessura do contorno",
  strokeDash: "tracejado",
  radius: "arredondamento",
  shadow: "sombra",
  fontFamily: "fonte",
  fontSize: "tamanho da fonte",
  fontWeight: "peso da fonte",
  fontStyle: "estilo da fonte",
  textAlign: "alinhamento",
  lineHeight: "entrelinha",
  letterSpacing: "espaçamento entre letras",
  underline: "sublinhado",
  linethrough: "tachado",
  background: "fundo",
  src: "imagem",
  crop: "recorte",
  children: "conteúdo do grupo",
  guides: "guias",
  objects: "objetos",
  flipX: "espelhamento horizontal",
  flipY: "espelhamento vertical",
  overrides: "alterações da instância",
};

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "nenhum";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  if (typeof v === "string") {
    if (v.startsWith("data:")) return "imagem embutida";
    const t = v.replace(/\s+/g, " ");
    return `“${t.length > 48 ? `${t.slice(0, 48)}…` : t}”`;
  }
  if (Array.isArray(v)) return `${v.length} item(ns)`;
  if (typeof v === "object" && "stops" in (v as object)) return "degradê";
  return "alterado";
}

const SKIP_DIFF = new Set(["measure", "legacy", "fabricStyles"]);

function objectChanges(before: DesignObject | null, after: DesignObject | null): FieldChange[] {
  const id = (after ?? before)!.id;
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    if (SKIP_DIFF.has(k)) continue;
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (a === b || JSON.stringify(a) === JSON.stringify(b)) continue;
    if (k === "children") {
      out.push({ id, field: k, before: Array.isArray(a) ? a.length : 0, after: Array.isArray(b) ? b.length : 0 });
      continue;
    }
    out.push({ id, field: k, before: a, after: b });
  }
  return out;
}

function summarizeChanges(label: string, changes: FieldChange[]) {
  if (!changes.length) return `${label}: sem alterações`;
  const parts = changes.slice(0, 3).map((c) => `${FIELD_LABEL[c.field] ?? c.field} ${fmt(c.before)} → ${fmt(c.after)}`);
  const more = changes.length > 3 ? `; e mais ${changes.length - 3}` : "";
  return `${label}: ${parts.join("; ")}${more}`;
}

const objTarget = (o: DesignObject, pageId: string | null): OpTarget => ({
  kind: "object",
  id: o.id,
  label: describeObject(o),
  pageId,
});
const pageLabel = (doc: DesignDocument, pageId: string | null) => {
  if (!pageId) return "componente";
  const i = doc.pages.findIndex((p) => p.id === pageId);
  return i < 0 ? "página" : doc.pages[i]!.name || `Página ${i + 1}`;
};

/* ------------------------------------------------------------------ */
/* Acesso estrutural com compartilhamento (só copia o caminho alterado) */
/* ------------------------------------------------------------------ */

type Container = { pageId: string | null; componentId: string | null; parentId: string | null };

const containerOf = (loc: ObjectLocation): Container => ({
  pageId: loc.pageId,
  componentId: loc.componentId,
  parentId: loc.parentId,
});
const sameContainer = (a: Container, b: Container) =>
  a.pageId === b.pageId && a.componentId === b.componentId && a.parentId === b.parentId;

function mapTree(
  list: DesignObject[],
  path: string[],
  fn: (l: DesignObject[]) => DesignObject[],
  ctx: Ctx,
): DesignObject[] {
  if (!path.length) return fn(list);
  const [head, ...rest] = path;
  let found = false;
  const out = list.map((o) => {
    if (o.id !== head || o.type !== "group") return o;
    found = true;
    return withGroupBox({ ...o, children: mapTree(o.children, rest, fn, ctx) });
  });
  if (!found) fail(ctx, "Grupo não encontrado.");
  return out;
}

function getList(doc: DesignDocument, c: Container, ctx: Ctx): DesignObject[] {
  let list: DesignObject[] | undefined;
  if (c.pageId) list = doc.pages.find((p) => p.id === c.pageId)?.objects;
  else if (c.componentId) list = doc.components.find((x) => x.id === c.componentId)?.objects;
  if (!list) return fail(ctx, c.pageId ? "Página não encontrada." : "Componente não encontrado.");
  if (!c.parentId) return list;
  const g = locate(doc, c.parentId);
  if (!g || g.object.type !== "group") return fail(ctx, "Grupo não encontrado.");
  return g.object.children;
}

function editList(
  doc: DesignDocument,
  c: Container,
  fn: (l: DesignObject[]) => DesignObject[],
  ctx: Ctx,
): DesignDocument {
  let path: string[] = [];
  if (c.parentId) {
    const g = locate(doc, c.parentId);
    if (!g || g.object.type !== "group") return fail(ctx, "Grupo não encontrado.");
    if (g.pageId !== c.pageId || g.componentId !== c.componentId) return fail(ctx, "O grupo está em outro lugar.");
    path = [...g.ancestors, c.parentId];
  }
  if (c.pageId) {
    const i = doc.pages.findIndex((p) => p.id === c.pageId);
    if (i < 0) return fail(ctx, "Página não encontrada.");
    const pages = doc.pages.slice();
    pages[i] = { ...pages[i]!, objects: mapTree(pages[i]!.objects, path, fn, ctx) };
    return { ...doc, pages };
  }
  const i = doc.components.findIndex((x) => x.id === c.componentId);
  if (i < 0) return fail(ctx, "Componente não encontrado.");
  const components = doc.components.slice();
  components[i] = { ...components[i]!, objects: mapTree(components[i]!.objects, path, fn, ctx) };
  return { ...doc, components };
}

function mustLocate(doc: DesignDocument, id: string, ctx: Ctx) {
  return locate(doc, id) ?? fail(ctx, `Elemento não encontrado: ${id}.`);
}

function validObject(o: unknown, ctx: Ctx): DesignObject {
  const r = designObjectSchema.safeParse(o);
  if (!r.success) {
    const i = r.error.issues[0];
    return fail(ctx, `Valor inválido${i ? ` em ${i.path.join(".") || "objeto"}: ${i.message}` : ""}.`);
  }
  return r.data;
}

/** Troca um objeto (onde quer que esteja), validando o resultado. */
function editObject(doc: DesignDocument, id: string, fn: (o: DesignObject) => DesignObject, ctx: Ctx) {
  const loc = mustLocate(doc, id, ctx);
  const next = validObject(fn(loc.object), ctx);
  if (next.id !== id) fail(ctx, "O identificador do elemento não pode mudar.");
  const out = editList(doc, containerOf(loc), (l) => l.map((o) => (o.id === id ? next : o)), ctx);
  return { doc: out, before: loc.object, after: next, loc };
}

function replaceStep(
  doc: DesignDocument,
  op: DesignOp,
  id: string,
  fn: (o: DesignObject) => DesignObject,
  ctx: Ctx,
): Step {
  const r = editObject(doc, id, fn, ctx);
  const changes = objectChanges(r.before, r.after);
  return {
    doc: r.doc,
    applied: op,
    inverse: [{ op: "replace", id, object: r.before }],
    diff: {
      op: op.op,
      summary: summarizeChanges(describeObject(r.before), changes),
      targets: [objTarget(r.after, r.loc.pageId)],
      changes,
    },
  };
}

/** Vários objetos alterados numa operação: inversas e diffs agregados. */
function multiStep(
  doc: DesignDocument,
  op: DesignOp,
  list: string[],
  fn: (o: DesignObject) => DesignObject,
  ctx: Ctx,
  verb: string,
): Step {
  let cur = doc;
  const inverse: DesignOp[] = [];
  const changes: FieldChange[] = [];
  const targets: OpTarget[] = [];
  for (const id of topLevel(doc, list, ctx)) {
    const r = editObject(cur, id, fn, ctx);
    cur = r.doc;
    inverse.unshift({ op: "replace", id, object: r.before });
    changes.push(...objectChanges(r.before, r.after));
    targets.push(objTarget(r.after, r.loc.pageId));
  }
  const summary =
    targets.length === 1 ? summarizeChanges(targets[0]!.label, changes) : `${verb} ${targets.length} elementos`;
  return { doc: cur, applied: op, inverse, diff: { op: op.op, summary, targets, changes } };
}

/** Ids sem os que já estão dentro de outro id da lista (o grupo leva os filhos). */
function topLevel(doc: DesignDocument, list: string[], ctx: Ctx): string[] {
  const set = new Set(list);
  const out: string[] = [];
  for (const id of new Set(list)) {
    const loc = mustLocate(doc, id, ctx);
    if (loc.ancestors.some((a) => set.has(a))) continue;
    out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cópias com novos ids                                                */
/* ------------------------------------------------------------------ */

function cloneWithIds(o: DesignObject, map: Record<string, string>, ctx: Ctx): DesignObject {
  const id = (map[o.id] ??= ctx.newId());
  if (o.type === "group") return { ...o, id, children: o.children.map((c) => cloneWithIds(c, map, ctx)) };
  return { ...o, id };
}

/* ------------------------------------------------------------------ */
/* Estilos                                                             */
/* ------------------------------------------------------------------ */

const TEXT_KEYS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textAlign",
  "lineHeight",
  "letterSpacing",
  "underline",
  "linethrough",
  "background",
  "stroke",
  "strokeWidth",
] as const;
const SHAPES = new Set(["rect", "ellipse", "triangle", "polygon", "path"]);

function applyStyle(o: DesignObject, s: StylePatch): DesignObject {
  if (o.type === "group") return withGroupBox({ ...o, children: o.children.map((c) => applyStyle(c, s)) });
  const next = { ...o } as Record<string, unknown>;
  if (s.opacity !== undefined) next.opacity = s.opacity;
  if (s.shadow !== undefined) next.shadow = s.shadow;
  if (o.type === "text") {
    const color = s.color ?? s.fill;
    if (color) next.color = color;
    for (const k of TEXT_KEYS) if (s[k] !== undefined) next[k] = s[k];
  } else if (SHAPES.has(o.type)) {
    const fill = s.fill !== undefined ? s.fill : s.color;
    if (fill !== undefined) next.fill = fill;
    if (s.stroke !== undefined) next.stroke = s.stroke;
    if (s.strokeWidth !== undefined) next.strokeWidth = s.strokeWidth;
    if (s.strokeDash !== undefined) next.strokeDash = s.strokeDash;
    if (o.type === "rect" && s.radius !== undefined) next.radius = s.radius;
    if (o.type === "path" && s.lineCap !== undefined) next.lineCap = s.lineCap;
  } else if (o.type === "line") {
    const stroke = s.stroke ?? s.color ?? (typeof s.fill === "string" ? s.fill : undefined);
    if (stroke) next.stroke = stroke;
    if (s.strokeWidth !== undefined) next.strokeWidth = s.strokeWidth;
    if (s.strokeDash !== undefined) next.strokeDash = s.strokeDash;
    if (s.lineCap !== undefined) next.lineCap = s.lineCap;
  } else if (o.type === "image") {
    if (s.radius !== undefined) next.radius = s.radius;
    if (s.stroke !== undefined) next.stroke = s.stroke;
    if (s.strokeWidth !== undefined) next.strokeWidth = s.strokeWidth;
  } else if (o.type === "instance") {
    // Cores de instância mudam pelas alterações por objeto (overrideInstance).
  }
  return next as DesignObject;
}

/* ------------------------------------------------------------------ */
/* Imagens                                                             */
/* ------------------------------------------------------------------ */

/** Recorte "preencher" (cobre a caixa) com zoom e ponto de foco. */
export function coverCrop(
  natural: { width: number; height: number },
  box: { width: number; height: number },
  zoom = 1,
  focus = { x: 0.5, y: 0.5 },
): Crop {
  const boxRatio = box.width / Math.max(box.height, 1e-6);
  let w = natural.width;
  let h = w / boxRatio;
  if (h > natural.height) {
    h = natural.height;
    w = h * boxRatio;
  }
  w /= zoom;
  h /= zoom;
  const x = Math.min(Math.max(0, natural.width * focus.x - w / 2), natural.width - w);
  const y = Math.min(Math.max(0, natural.height * focus.y - h / 2), natural.height - h);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(x), y: r(y), width: r(w), height: r(h) };
}

function fitImage(
  img: ImageObject,
  mode: "fill" | "fit" | "stretch",
  zoom?: number,
  fx?: number,
  fy?: number,
  ctx?: Ctx,
): ImageObject {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (mode === "stretch") return { ...img, crop: null };
  if (!nw || !nh) return ctx ? fail(ctx, "Tamanho original da imagem desconhecido.") : img;
  if (mode === "fit") {
    const c = centerOf(img);
    const s = Math.min(img.width / nw, img.height / nh);
    const width = Math.round(nw * s * 100) / 100;
    const height = Math.round(nh * s * 100) / 100;
    return { ...img, crop: null, width, height, x: c.x - width / 2, y: c.y - height / 2 };
  }
  return { ...img, crop: coverCrop({ width: nw, height: nh }, img, zoom ?? 1, { x: fx ?? 0.5, y: fy ?? 0.5 }) };
}

/* ------------------------------------------------------------------ */
/* Paleta                                                              */
/* ------------------------------------------------------------------ */

function paletteMapper(map: { from: string; to: string }[]) {
  const m = new Map(map.map((x) => [x.from.trim().toLowerCase(), x.to]));
  const color = (c: string) => m.get(c.trim().toLowerCase()) ?? c;
  const paint = <T extends Paint | null | undefined>(p: T): T => {
    if (!p) return p;
    if (typeof p === "string") return color(p) as T;
    const g = p as Exclude<Paint, string>;
    return { ...g, stops: g.stops.map((s) => ({ ...s, color: color(s.color) })) } as T;
  };
  const obj = (o: DesignObject): DesignObject => {
    const next = { ...o } as Record<string, unknown>;
    if ("fill" in o) next.fill = paint(o.fill as Paint | null);
    if ("stroke" in o && typeof o.stroke === "string") next.stroke = color(o.stroke);
    if (o.type === "text") {
      next.color = paint(o.color);
      if (o.background) next.background = color(o.background);
    }
    if (o.shadow) next.shadow = { ...o.shadow, color: color(o.shadow.color) };
    if (o.type === "group") next.children = o.children.map(obj);
    if (o.type === "instance" && o.overrides) {
      next.overrides = Object.fromEntries(
        Object.entries(o.overrides).map(([k, v]) => [
          k,
          { ...v, ...(v.color ? { color: paint(v.color) } : {}), ...(v.fill ? { fill: paint(v.fill) } : {}) },
        ]),
      );
    }
    const changed = JSON.stringify(next) !== JSON.stringify(o);
    return changed ? (next as DesignObject) : o;
  };
  return { paint, obj };
}

/* ------------------------------------------------------------------ */
/* Componentes                                                         */
/* ------------------------------------------------------------------ */

/** Objetos de um componente posicionados e escalados na caixa da instância (com as alterações locais). */
export function instanceChildren(doc: DesignDocument, inst: InstanceObject): DesignObject[] {
  const comp = doc.components.find((c) => c.id === inst.componentId);
  if (!comp) return [];
  const sx = comp.width ? inst.width / comp.width : 1;
  const sy = comp.height ? inst.height / comp.height : 1;
  const apply = (o: DesignObject): DesignObject => {
    const ov = inst.overrides?.[o.id];
    let next: DesignObject = o;
    if (ov) {
      const n = { ...o } as Record<string, unknown>;
      if (ov.text !== undefined && o.type === "text") n.text = ov.text;
      if (ov.src !== undefined && o.type === "image") n.src = ov.src;
      if (ov.color !== undefined && o.type === "text") n.color = ov.color;
      if (ov.fill !== undefined && "fill" in o) n.fill = ov.fill;
      if (ov.hidden !== undefined) n.hidden = ov.hidden;
      next = n as DesignObject;
    }
    if (next.type === "group") next = { ...next, children: next.children.map(apply) };
    return next;
  };
  return comp.objects.map((o) => scaleObject(apply(o), sx, sy, { x: 0, y: 0 }));
}

/* ------------------------------------------------------------------ */
/* Operações                                                           */
/* ------------------------------------------------------------------ */

type Handler<K extends DesignOpName> = (doc: DesignDocument, op: Extract<DesignOp, { op: K }>, ctx: Ctx) => Step;

const resolveContainer = (
  doc: DesignDocument,
  c: { pageId?: string; componentId?: string; parentId?: string | null },
  ctx: Ctx,
): Container => {
  if (c.parentId) {
    const g = mustLocate(doc, c.parentId, ctx);
    if (g.object.type !== "group") fail(ctx, "O destino não é um grupo.");
    return { pageId: g.pageId, componentId: g.componentId, parentId: c.parentId };
  }
  if (c.componentId) return { pageId: null, componentId: c.componentId, parentId: null };
  return { pageId: c.pageId ?? doc.pages[0]!.id, componentId: null, parentId: null };
};

function insertAt<T>(list: T[], item: T, index?: number) {
  const out = list.slice();
  out.splice(index === undefined ? out.length : Math.min(index, out.length), 0, item);
  return out;
}

const handlers: { [K in DesignOpName]: Handler<K> } = {
  add(doc, op, ctx) {
    if (locate(doc, op.object.id) || doc.pages.some((p) => p.id === op.object.id))
      fail(ctx, `Já existe um elemento com o id ${op.object.id}.`);
    const c = resolveContainer(doc, op, ctx);
    const object = validObject(op.object, ctx);
    const next = editList(doc, c, (l) => insertAt(l, object, op.index), ctx);
    return {
      doc: next,
      applied: { ...op, pageId: c.pageId ?? undefined, componentId: c.componentId ?? undefined, parentId: c.parentId },
      inverse: [{ op: "remove", ids: [object.id] }],
      diff: {
        op: "add",
        summary: `Adicionado ${describeObject(object)} em ${pageLabel(doc, c.pageId)}`,
        targets: [objTarget(object, c.pageId)],
        changes: [],
      },
    };
  },

  remove(doc, op, ctx) {
    const list = topLevel(doc, op.ids, ctx).map((id) => mustLocate(doc, id, ctx));
    // A inversa readiciona na ordem crescente de posição, devolvendo cada um ao lugar exato.
    const restore = [...list].sort((a, b) => a.index - b.index);
    let cur = doc;
    for (const loc of list) {
      cur = editList(cur, containerOf(loc), (l) => l.filter((o) => o.id !== loc.object.id), ctx);
    }
    const inverse: DesignOp[] = restore.map((loc) => ({
      op: "add",
      object: loc.object,
      index: loc.index,
      ...(loc.pageId ? { pageId: loc.pageId } : {}),
      ...(loc.componentId ? { componentId: loc.componentId } : {}),
      parentId: loc.parentId,
    }));
    const targets = list.map((l) => objTarget(l.object, l.pageId));
    return {
      doc: cur,
      applied: op,
      inverse,
      diff: {
        op: "remove",
        summary: targets.length === 1 ? `Removido ${targets[0]!.label}` : `Removidos ${targets.length} elementos`,
        targets,
        changes: [],
      },
    };
  },

  update(doc, op, ctx) {
    for (const k of ["id", "type", "children"]) if (k in op.set) fail(ctx, `A propriedade ${k} não pode ser alterada.`);
    return replaceStep(
      doc,
      op,
      op.id,
      (o) => {
        const geometry = ["x", "y", "width", "height", "rotation"].filter((k) => k in op.set);
        const rest = Object.fromEntries(Object.entries(op.set).filter(([k]) => !geometry.includes(k)));
        let next = { ...o, ...rest } as DesignObject;
        if (geometry.length) {
          const box = Object.fromEntries(geometry.map((k) => [k, op.set[k]])) as Record<string, number>;
          if (Object.values(box).some((v) => typeof v !== "number" || !Number.isFinite(v)))
            fail(ctx, "Posição ou tamanho inválido.");
          next = setObjectBox(next, box);
        }
        for (const k of op.unset ?? []) delete (next as Record<string, unknown>)[k];
        if (next.type === "text" && o.type === "text" && next.text !== o.text && next.fabricStyles)
          delete next.fabricStyles;
        return next;
      },
      ctx,
    );
  },

  replace(doc, op, ctx) {
    if (op.object.id !== op.id) fail(ctx, "O identificador do elemento não pode mudar.");
    return replaceStep(doc, op, op.id, () => op.object, ctx);
  },

  setText(doc, op, ctx) {
    return replaceStep(
      doc,
      op,
      op.id,
      (o) => {
        if (o.type !== "text") return fail(ctx, "O elemento não é um texto.");
        const { fabricStyles: _s, ...rest } = o;
        void _s;
        return { ...rest, text: op.text };
      },
      ctx,
    );
  },

  setStyle(doc, op, ctx) {
    return multiStep(doc, op, op.ids, (o) => applyStyle(o, op.style), ctx, "Estilo alterado em");
  },

  transform(doc, op, ctx) {
    const { x, y, width, height, rotation } = op;
    return replaceStep(
      doc,
      op,
      op.id,
      // Em grupos a rotação é relativa (o grupo gira os filhos e não guarda ângulo próprio).
      (o) => setObjectBox(o, { x, y, width, height, rotation }),
      ctx,
    );
  },

  move(doc, op, ctx) {
    return multiStep(doc, op, op.ids, (o) => translateObject(o, op.dx, op.dy), ctx, "Movidos");
  },

  resize(doc, op, ctx) {
    const objs = topLevel(doc, op.ids, ctx).map((id) => mustLocate(doc, id, ctx).object);
    const b = unionBoxes(objs.map(aabbOf));
    const origin = { x: op.originX ?? b.x, y: op.originY ?? b.y };
    return multiStep(doc, op, op.ids, (o) => scaleObject(o, op.scaleX, op.scaleY, origin), ctx, "Redimensionados");
  },

  replaceImage(doc, op, ctx) {
    return replaceStep(
      doc,
      op,
      op.id,
      (o) => {
        if (o.type !== "image") return fail(ctx, "O elemento não é uma imagem.");
        const img: ImageObject = {
          ...o,
          src: op.src,
          naturalWidth: op.naturalWidth,
          naturalHeight: op.naturalHeight,
          crop: null,
        };
        return fitImage(img, op.fit ?? "fill", 1, 0.5, 0.5, ctx);
      },
      ctx,
    );
  },

  imageFit(doc, op, ctx) {
    return replaceStep(
      doc,
      op,
      op.id,
      (o) =>
        o.type === "image"
          ? fitImage(o, op.mode, op.zoom, op.focusX, op.focusY, ctx)
          : fail(ctx, "O elemento não é uma imagem."),
      ctx,
    );
  },

  crop(doc, op, ctx) {
    return replaceStep(
      doc,
      op,
      op.id,
      (o) => {
        if (o.type !== "image") return fail(ctx, "O elemento não é uma imagem.");
        if (op.crop && o.naturalWidth && o.naturalHeight) {
          const c = op.crop;
          if (c.x < 0 || c.y < 0 || c.x + c.width > o.naturalWidth + 0.5 || c.y + c.height > o.naturalHeight + 0.5)
            fail(ctx, "O recorte passa dos limites da imagem.");
        }
        return { ...o, crop: op.crop };
      },
      ctx,
    );
  },

  duplicate(doc, op, ctx) {
    const map: Record<string, string> = { ...(op.idMap ?? {}) };
    const dx = op.dx ?? 24;
    const dy = op.dy ?? 24;
    let cur = doc;
    const created: DesignObject[] = [];
    const targets: OpTarget[] = [];
    const top = topLevel(doc, op.ids, ctx);
    for (const id of top) {
      const loc = mustLocate(cur, id, ctx);
      const copy = translateObject(cloneWithIds(loc.object, map, ctx), dx, dy);
      const c = containerOf(loc);
      const index = getList(cur, c, ctx).findIndex((o) => o.id === id);
      cur = editList(cur, c, (l) => insertAt(l, copy, index + 1), ctx);
      created.push(copy);
      targets.push(objTarget(copy, loc.pageId));
    }
    for (const id of Object.values(map)) {
      if (doc.pages.some((p) => p.id === id) || locate(doc, id)) fail(ctx, `Id já usado: ${id}.`);
    }
    return {
      doc: cur,
      applied: { ...op, dx, dy, idMap: map },
      inverse: [{ op: "remove", ids: created.map((o) => o.id) }],
      diff: {
        op: "duplicate",
        summary:
          created.length === 1 ? `Duplicado ${describeObject(created[0]!)}` : `Duplicados ${created.length} elementos`,
        targets,
        changes: [],
      },
    };
  },

  reorder(doc, op, ctx) {
    const loc = mustLocate(doc, op.id, ctx);
    const c = containerOf(loc);
    const list = getList(doc, c, ctx);
    const from = loc.index;
    const last = list.length - 1;
    const to =
      op.to === "front"
        ? last
        : op.to === "back"
          ? 0
          : op.to === "forward"
            ? Math.min(last, from + 1)
            : op.to === "backward"
              ? Math.max(0, from - 1)
              : Math.min(op.to, last);
    const next = editList(
      doc,
      c,
      (l) => {
        const out = l.slice();
        const [item] = out.splice(from, 1);
        out.splice(to, 0, item!);
        return out;
      },
      ctx,
    );
    const where = to === last ? "para a frente de tudo" : to === 0 ? "para o fundo" : `para a posição ${to + 1}`;
    return {
      doc: next,
      applied: { ...op, to },
      inverse: [{ op: "reorder", id: op.id, to: from }],
      diff: {
        op: "reorder",
        summary: `${describeObject(loc.object)} ${from === to ? "não mudou de camada" : where}`,
        targets: [objTarget(loc.object, loc.pageId)],
        changes: [{ id: op.id, field: "camada", before: from, after: to }],
      },
    };
  },

  reparent(doc, op, ctx) {
    const loc = mustLocate(doc, op.id, ctx);
    const target = resolveContainer(doc, op, ctx);
    if (target.parentId) {
      const g = mustLocate(doc, target.parentId, ctx);
      if (target.parentId === op.id || g.ancestors.includes(op.id)) fail(ctx, "Um grupo não pode entrar em si mesmo.");
    }
    if (target.componentId && loc.object.type === "instance" && loc.object.componentId === target.componentId)
      fail(ctx, "Um componente não pode conter a si mesmo.");
    const from = containerOf(loc);
    let cur = editList(doc, from, (l) => l.filter((o) => o.id !== op.id), ctx);
    cur = editList(cur, target, (l) => insertAt(l, loc.object, op.index), ctx);
    const newIndex = getList(cur, target, ctx).findIndex((o) => o.id === op.id);
    return {
      doc: cur,
      applied: { ...op, index: newIndex },
      inverse: [
        {
          op: "reparent",
          id: op.id,
          index: loc.index,
          ...(from.pageId ? { pageId: from.pageId } : {}),
          ...(from.componentId ? { componentId: from.componentId } : {}),
          parentId: from.parentId,
        },
      ],
      diff: {
        op: "reparent",
        summary: `${describeObject(loc.object)} movido para ${target.parentId ? "o grupo" : pageLabel(doc, target.pageId)}`,
        targets: [objTarget(loc.object, target.pageId)],
        changes: [],
      },
    };
  },

  group(doc, op, ctx) {
    const locs = topLevel(doc, op.ids, ctx).map((id) => mustLocate(doc, id, ctx));
    if (locs.length < 1) fail(ctx, "Selecione elementos para agrupar.");
    const c = containerOf(locs[0]!);
    if (locs.some((l) => !sameContainer(containerOf(l), c)))
      fail(ctx, "Só é possível agrupar elementos do mesmo nível.");
    const groupId = op.groupId ?? ctx.newId();
    if (locate(doc, groupId)) fail(ctx, `Id já usado: ${groupId}.`);
    const before = getList(doc, c, ctx);
    const members = new Set(locs.map((l) => l.object.id));
    const children = before.filter((o) => members.has(o.id));
    const topIndex = Math.max(...locs.map((l) => l.index));
    const g = withGroupBox({
      id: groupId,
      type: "group" as const,
      name: op.name ?? "Grupo",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      opacity: 1,
      children,
    });
    const next = editList(
      doc,
      c,
      (l) => {
        const out: DesignObject[] = [];
        l.forEach((o, i) => {
          if (i === topIndex) out.push(g);
          if (!members.has(o.id)) out.push(o);
        });
        return out;
      },
      ctx,
    );
    return {
      doc: next,
      applied: { ...op, groupId },
      inverse: [{ op: "restoreList", objects: before, ...listOwner(c) }],
      diff: {
        op: "group",
        summary: `Agrupados ${children.length} elementos`,
        targets: [objTarget(g, c.pageId)],
        changes: [],
      },
    };
  },

  ungroup(doc, op, ctx) {
    const loc = mustLocate(doc, op.id, ctx);
    if (loc.object.type !== "group") fail(ctx, "O elemento não é um grupo.");
    const g = loc.object as GroupObject;
    const c = containerOf(loc);
    const before = getList(doc, c, ctx);
    // Opacidade do grupo passa para os filhos (o visual não muda).
    const children = g.children.map((ch) =>
      g.opacity !== 1 ? { ...ch, opacity: Math.round(ch.opacity * g.opacity * 1000) / 1000 } : ch,
    );
    const next = editList(doc, c, (l) => l.flatMap((o) => (o.id === op.id ? children : [o])), ctx);
    return {
      doc: next,
      applied: op,
      inverse: [{ op: "restoreList", objects: before, ...listOwner(c) }],
      diff: {
        op: "ungroup",
        summary: `Desagrupado ${describeObject(g)} (${children.length} elementos)`,
        targets: [objTarget(g, c.pageId)],
        changes: [],
      },
    };
  },

  restoreList(doc, op, ctx) {
    const c = resolveContainer(doc, op, ctx);
    const before = getList(doc, c, ctx);
    const objects = op.objects.map((o) => validObject(o, ctx));
    const next = editList(doc, c, () => objects, ctx);
    return {
      doc: next,
      applied: op,
      inverse: [{ op: "restoreList", objects: before, ...listOwner(c) }],
      diff: {
        op: "restoreList",
        summary: `Camadas restauradas em ${pageLabel(doc, c.pageId)}`,
        targets: [],
        changes: [],
      },
    };
  },

  align(doc, op, ctx) {
    const locs = topLevel(doc, op.ids, ctx).map((id) => mustLocate(doc, id, ctx));
    const boxes = locs.map((l) => aabbOf(l.object));
    let ref = unionBoxes(boxes);
    if (op.to === "page" || locs.length === 1) {
      const page = doc.pages.find((p) => p.id === locs[0]!.pageId);
      if (page) ref = { x: 0, y: 0, width: page.width, height: page.height };
    }
    const delta = (b: (typeof boxes)[number]) => {
      switch (op.edge) {
        case "left":
          return { dx: ref.x - b.x, dy: 0 };
        case "hcenter":
          return { dx: ref.x + ref.width / 2 - (b.x + b.width / 2), dy: 0 };
        case "right":
          return { dx: ref.x + ref.width - (b.x + b.width), dy: 0 };
        case "top":
          return { dx: 0, dy: ref.y - b.y };
        case "vcenter":
          return { dx: 0, dy: ref.y + ref.height / 2 - (b.y + b.height / 2) };
        case "bottom":
          return { dx: 0, dy: ref.y + ref.height - (b.y + b.height) };
      }
    };
    const moves = new Map(locs.map((l, i) => [l.object.id, delta(boxes[i]!)]));
    return multiStep(
      doc,
      op,
      locs.map((l) => l.object.id),
      (o) => {
        const d = moves.get(o.id)!;
        return translateObject(o, d.dx, d.dy);
      },
      ctx,
      "Alinhados",
    );
  },

  distribute(doc, op, ctx) {
    const locs = topLevel(doc, op.ids, ctx).map((id) => mustLocate(doc, id, ctx));
    if (locs.length < 3) fail(ctx, "Selecione pelo menos três elementos para distribuir.");
    const items = locs.map((l) => ({ id: l.object.id, b: aabbOf(l.object) }));
    const h = op.axis === "horizontal";
    items.sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0]!.b;
    const last = items.at(-1)!.b;
    const span = h ? last.x + last.width - first.x : last.y + last.height - first.y;
    const total = items.reduce((n, i) => n + (h ? i.b.width : i.b.height), 0);
    const gap = (span - total) / (items.length - 1);
    let pos = h ? first.x : first.y;
    const moves = new Map<string, number>();
    for (const it of items) {
      moves.set(it.id, pos - (h ? it.b.x : it.b.y));
      pos += (h ? it.b.width : it.b.height) + gap;
    }
    return multiStep(
      doc,
      op,
      items.map((i) => i.id),
      (o) => (h ? translateObject(o, moves.get(o.id)!, 0) : translateObject(o, 0, moves.get(o.id)!)),
      ctx,
      "Distribuídos",
    );
  },

  addPage(doc, op, ctx) {
    if (doc.pages.length >= 100) fail(ctx, "Limite de 100 páginas.");
    if (doc.pages.some((p) => p.id === op.page.id)) fail(ctx, "Já existe uma página com esse id.");
    const page = validPage(op.page, ctx);
    const index = op.index === undefined ? doc.pages.length : Math.min(op.index, doc.pages.length);
    return {
      doc: { ...doc, pages: insertAt(doc.pages, page, index) },
      applied: { ...op, index },
      inverse: [{ op: "removePage", id: page.id }],
      diff: {
        op: "addPage",
        summary: `Página adicionada: ${page.name || `Página ${index + 1}`}`,
        targets: [{ kind: "page", id: page.id, label: page.name }],
        changes: [],
      },
    };
  },

  removePage(doc, op, ctx) {
    const index = doc.pages.findIndex((p) => p.id === op.id);
    if (index < 0) fail(ctx, "Página não encontrada.");
    if (doc.pages.length === 1) fail(ctx, "A arte precisa de pelo menos uma página.");
    const page = doc.pages[index]!;
    return {
      doc: { ...doc, pages: doc.pages.filter((p) => p.id !== op.id) },
      applied: op,
      inverse: [{ op: "addPage", page, index }],
      diff: {
        op: "removePage",
        summary: `Página removida: ${page.name}`,
        targets: [{ kind: "page", id: page.id, label: page.name }],
        changes: [],
      },
    };
  },

  updatePage(doc, op, ctx) {
    const index = doc.pages.findIndex((p) => p.id === op.id);
    if (index < 0) fail(ctx, "Página não encontrada.");
    const before = doc.pages[index]!;
    const after = validPage({ ...before, ...op.set }, ctx);
    return pageStep(doc, op, before, after);
  },

  replacePage(doc, op, ctx) {
    const index = doc.pages.findIndex((p) => p.id === op.page.id);
    if (index < 0) fail(ctx, "Página não encontrada.");
    return pageStep(doc, op, doc.pages[index]!, validPage(op.page, ctx));
  },

  reorderPage(doc, op, ctx) {
    const from = doc.pages.findIndex((p) => p.id === op.id);
    if (from < 0) fail(ctx, "Página não encontrada.");
    const to = Math.min(op.index, doc.pages.length - 1);
    const pages = doc.pages.slice();
    const [page] = pages.splice(from, 1);
    pages.splice(to, 0, page!);
    return {
      doc: { ...doc, pages },
      applied: { ...op, index: to },
      inverse: [{ op: "reorderPage", id: op.id, index: from }],
      diff: {
        op: "reorderPage",
        summary: `${page!.name} movida da posição ${from + 1} para ${to + 1}`,
        targets: [{ kind: "page", id: op.id, label: page!.name }],
        changes: [{ id: op.id, field: "ordem", before: from + 1, after: to + 1 }],
      },
    };
  },

  duplicatePage(doc, op, ctx) {
    const from = doc.pages.findIndex((p) => p.id === op.id);
    if (from < 0) fail(ctx, "Página não encontrada.");
    if (doc.pages.length >= 100) fail(ctx, "Limite de 100 páginas.");
    const src = doc.pages[from]!;
    const map: Record<string, string> = { ...(op.idMap ?? {}) };
    const newPageId = op.newPageId ?? ctx.newId();
    const page: DesignPage = {
      ...src,
      id: newPageId,
      name: `${src.name} (cópia)`.slice(0, 80),
      objects: src.objects.map((o) => cloneWithIds(o, map, ctx)),
    };
    const index = op.index ?? from + 1;
    return {
      doc: { ...doc, pages: insertAt(doc.pages, page, index) },
      applied: { ...op, newPageId, idMap: map, index },
      inverse: [{ op: "removePage", id: newPageId }],
      diff: {
        op: "duplicatePage",
        summary: `Página duplicada: ${src.name}`,
        targets: [{ kind: "page", id: newPageId, label: page.name }],
        changes: [],
      },
    };
  },

  changePalette(doc, op, ctx) {
    const { paint, obj } = paletteMapper(op.map);
    const inverse: DesignOp[] = [];
    let changedObjects = 0;
    const pages = doc.pages.map((p) => {
      if (op.pageId && p.id !== op.pageId) return p;
      const objects = p.objects.map(obj);
      const background = paint(p.background);
      const changed =
        objects.some((o, i) => o !== p.objects[i]) || JSON.stringify(background) !== JSON.stringify(p.background);
      if (!changed) return p;
      changedObjects += objects.filter((o, i) => o !== p.objects[i]).length;
      inverse.push({ op: "replacePage", page: p });
      return { ...p, objects, background };
    });
    const components = op.pageId
      ? doc.components
      : doc.components.map((c) => {
          const objects = c.objects.map(obj);
          if (!objects.some((o, i) => o !== c.objects[i])) return c;
          inverse.push({ op: "replaceComponent", component: c });
          return { ...c, objects };
        });
    if (op.pageId && !doc.pages.some((p) => p.id === op.pageId)) fail(ctx, "Página não encontrada.");
    const summary = `Paleta alterada (${op.map.map((m) => `${m.from} → ${m.to}`).join(", ")}) em ${changedObjects} elemento(s)${op.pageId ? ` de ${pageLabel(doc, op.pageId)}` : ""}`;
    return {
      doc: { ...doc, pages, components },
      applied: op,
      inverse,
      diff: {
        op: "changePalette",
        summary,
        targets: op.pageId
          ? [{ kind: "page", id: op.pageId, label: pageLabel(doc, op.pageId) }]
          : [{ kind: "document", id: "doc", label: "Arte" }],
        changes: op.map.map((m) => ({ id: "palette", field: "cor", before: m.from, after: m.to })),
      },
    };
  },

  setMeta(doc, op, ctx) {
    const before = doc.meta ?? {};
    const meta = { ...before, ...op.set };
    const parsed = designMetaSchema.safeParse(meta);
    if (!parsed.success) fail(ctx, "Configuração inválida.");
    const keys = Object.keys(op.set) as (keyof typeof op.set)[];
    const prev = Object.fromEntries(keys.map((k) => [k, before[k] ?? null]));
    return {
      doc: { ...doc, meta: parsed.data },
      applied: op,
      inverse: [{ op: "replaceMeta", meta: doc.meta ?? null }],
      diff: {
        op: "setMeta",
        summary:
          op.set.carousel !== undefined
            ? op.set.carousel
              ? "Páginas conectadas (carrossel) ativadas"
              : "Páginas conectadas (carrossel) desativadas"
            : "Configurações da arte alteradas",
        targets: [{ kind: "document", id: "doc", label: "Arte" }],
        changes: keys.map((k) => ({ id: "doc", field: k, before: prev[k], after: op.set[k] })),
      },
    };
  },

  replaceMeta(doc, op) {
    const { meta: _m, ...rest } = doc;
    void _m;
    return {
      doc: op.meta ? { ...rest, meta: op.meta } : rest,
      applied: op,
      inverse: [{ op: "replaceMeta", meta: doc.meta ?? null }],
      diff: {
        op: "replaceMeta",
        summary: "Configurações da arte restauradas",
        targets: [{ kind: "document", id: "doc", label: "Arte" }],
        changes: [],
      },
    };
  },

  addComponent(doc, op, ctx) {
    if (doc.components.some((c) => c.id === op.component.id)) fail(ctx, "Já existe um componente com esse id.");
    const component = validComponent(op.component, ctx);
    return {
      doc: { ...doc, components: insertAt(doc.components, component, op.index) },
      applied: op,
      inverse: [{ op: "removeComponent", id: component.id }],
      diff: {
        op: "addComponent",
        summary: `Componente criado: ${component.name}`,
        targets: [{ kind: "component", id: component.id, label: component.name }],
        changes: [],
      },
    };
  },

  removeComponent(doc, op, ctx) {
    const index = doc.components.findIndex((c) => c.id === op.id);
    if (index < 0) fail(ctx, "Componente não encontrado.");
    const used = [...doc.pages.flatMap((p) => p.objects), ...doc.components.flatMap((c) => c.objects)]
      .flatMap(leavesAll)
      .some((o) => o.type === "instance" && o.componentId === op.id);
    if (used) fail(ctx, "O componente está em uso. Desvincule as instâncias antes.");
    const component = doc.components[index]!;
    return {
      doc: { ...doc, components: doc.components.filter((c) => c.id !== op.id) },
      applied: op,
      inverse: [{ op: "addComponent", component, index }],
      diff: {
        op: "removeComponent",
        summary: `Componente removido: ${component.name}`,
        targets: [{ kind: "component", id: component.id, label: component.name }],
        changes: [],
      },
    };
  },

  replaceComponent(doc, op, ctx) {
    const index = doc.components.findIndex((c) => c.id === op.component.id);
    if (index < 0) fail(ctx, "Componente não encontrado.");
    const before = doc.components[index]!;
    const after = validComponent(op.component, ctx);
    const components = doc.components.slice();
    components[index] = after;
    return {
      doc: { ...doc, components },
      applied: op,
      inverse: [{ op: "replaceComponent", component: before }],
      diff: {
        op: "replaceComponent",
        summary: `Componente atualizado: ${after.name} (todas as instâncias mudam)`,
        targets: [{ kind: "component", id: after.id, label: after.name }],
        changes: [],
      },
    };
  },

  createComponent(doc, op, ctx) {
    const locs = topLevel(doc, op.ids, ctx).map((id) => mustLocate(doc, id, ctx));
    const c = containerOf(locs[0]!);
    if (!c.pageId) fail(ctx, "Crie componentes a partir de elementos de uma página.");
    if (locs.some((l) => !sameContainer(containerOf(l), c))) fail(ctx, "Só é possível usar elementos do mesmo nível.");
    if (doc.components.length >= 200) fail(ctx, "Limite de 200 componentes.");
    const before = getList(doc, c, ctx);
    const members = new Set(locs.map((l) => l.object.id));
    const objects = before.filter((o) => members.has(o.id));
    const box = unionBoxes(objects.map(aabbOf));
    const componentId = op.componentId ?? ctx.newId();
    const instanceId = op.instanceId ?? ctx.newId();
    if (locate(doc, instanceId) || doc.components.some((x) => x.id === componentId)) fail(ctx, "Id já usado.");
    const name = op.name ?? (objects.length === 1 ? objects[0]!.name : "Componente");
    const component: DesignComponent = {
      id: componentId,
      name,
      width: Math.max(1, Math.round(box.width * 100) / 100),
      height: Math.max(1, Math.round(box.height * 100) / 100),
      objects: objects.map((o) => translateObject(o, -box.x, -box.y)),
    };
    const instance: InstanceObject = {
      id: instanceId,
      type: "instance",
      name,
      componentId,
      x: box.x,
      y: box.y,
      width: component.width,
      height: component.height,
      rotation: 0,
      opacity: 1,
    };
    const topIndex = Math.max(...locs.map((l) => l.index));
    let next: DesignDocument = { ...doc, components: [...doc.components, component] };
    next = editList(
      next,
      c,
      (l) => {
        const out: DesignObject[] = [];
        l.forEach((o, i) => {
          if (i === topIndex) out.push(instance);
          if (!members.has(o.id)) out.push(o);
        });
        return out;
      },
      ctx,
    );
    return {
      doc: next,
      applied: { ...op, componentId, instanceId, name },
      inverse: [
        { op: "restoreList", objects: before, ...listOwner(c) },
        { op: "removeComponent", id: componentId },
      ],
      diff: {
        op: "createComponent",
        summary: `Componente criado: ${name}`,
        targets: [{ kind: "component", id: componentId, label: name }],
        changes: [],
      },
    };
  },

  detachInstance(doc, op, ctx) {
    const map: Record<string, string> = { ...(op.idMap ?? {}) };
    let created: GroupObject | null = null;
    const step = replaceStep(
      doc,
      op,
      op.id,
      (o) => {
        if (o.type !== "instance") return fail(ctx, "O elemento não é uma instância de componente.");
        const children = instanceChildren(doc, o).map((ch) => translateObject(cloneWithIds(ch, map, ctx), o.x, o.y));
        if (!children.length) fail(ctx, "Componente vazio ou inexistente.");
        created = withGroupBox({
          id: o.id,
          type: "group" as const,
          name: o.name,
          x: o.x,
          y: o.y,
          width: o.width,
          height: o.height,
          rotation: 0,
          opacity: o.opacity,
          ...(o.hidden ? { hidden: true } : {}),
          ...(o.locked ? { locked: true } : {}),
          children,
        });
        // Rotação da instância passa para os filhos (em torno do centro da instância).
        if (o.rotation) created = rotateObject(created, o.rotation, centerOf(o));
        return created;
      },
      ctx,
    );
    return {
      ...step,
      applied: { ...op, idMap: map },
      diff: { ...step.diff, summary: `Instância desvinculada do componente: ${step.diff.targets[0]?.label ?? ""}` },
    };
  },

  overrideInstance(doc, op, ctx) {
    return replaceStep(
      doc,
      op,
      op.id,
      (o) => {
        if (o.type !== "instance") return fail(ctx, "O elemento não é uma instância de componente.");
        const overrides = { ...(o.overrides ?? {}) };
        if (op.set === null) delete overrides[op.childId];
        else overrides[op.childId] = { ...(overrides[op.childId] ?? {}), ...op.set } as InstanceOverride;
        const next: InstanceObject = { ...o, overrides };
        if (!Object.keys(overrides).length) delete next.overrides;
        return next;
      },
      ctx,
    );
  },

  setStyles(doc, op) {
    // Substitui os estilos salvos da arte (null = sem estilos).
    const { styles: before, ...rest } = doc;
    return {
      doc: op.styles ? { ...rest, styles: op.styles } : rest,
      applied: op,
      inverse: [{ op: "setStyles", styles: before ?? null }],
      diff: {
        op: "setStyles",
        summary: "Estilos da arte atualizados",
        targets: [{ kind: "document", id: "doc", label: "Arte" }],
        changes: [],
      },
    };
  },
};

function leavesAll(o: DesignObject): DesignObject[] {
  return o.type === "group" ? [o, ...o.children.flatMap(leavesAll)] : [o];
}

function listOwner(c: Container) {
  return {
    ...(c.pageId ? { pageId: c.pageId } : {}),
    ...(c.componentId ? { componentId: c.componentId } : {}),
    parentId: c.parentId,
  };
}

function validPage(p: unknown, ctx: Ctx): DesignPage {
  const r = designPageSchema.safeParse(p);
  if (!r.success) {
    const i = r.error.issues[0];
    return fail(ctx, `Página inválida${i ? ` (${i.path.join(".")}: ${i.message})` : ""}.`);
  }
  return r.data;
}

function validComponent(c: unknown, ctx: Ctx): DesignComponent {
  const r = designComponentSchema.safeParse(c);
  if (!r.success) return fail(ctx, "Componente inválido.");
  return r.data;
}

function pageStep(doc: DesignDocument, op: DesignOp, before: DesignPage, after: DesignPage): Step {
  const pages = doc.pages.map((p) => (p.id === before.id ? after : p));
  const changes: FieldChange[] = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changes.push({
      id: before.id,
      field: k,
      before: k === "objects" ? (a as unknown[]).length : a,
      after: k === "objects" ? (b as unknown[]).length : b,
    });
  }
  return {
    doc: { ...doc, pages },
    applied: op,
    inverse: [{ op: "replacePage", page: before }],
    diff: {
      op: op.op,
      summary: summarizeChanges(before.name || "Página", changes),
      targets: [{ kind: "page", id: before.id, label: before.name }],
      changes,
    },
  };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Aplica um lote de operações (atômico). Lança DesignOpError com o índice da
 * operação que falhou; o documento original nunca é alterado.
 */
export function applyOperations(
  doc: DesignDocument,
  ops: unknown[],
  opts: { newId?: () => string; validate?: boolean } = {},
): ApplyResult {
  const ctx: Ctx = { newId: opts.newId ?? (() => randomId()), index: 0 };
  let cur = doc;
  let inverse: DesignOp[] = [];
  const diffs: OpDiff[] = [];
  const applied: DesignOp[] = [];
  for (let i = 0; i < ops.length; i++) {
    ctx.index = i;
    const parsed = designOpSchema.safeParse(ops[i]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DesignOpError(
        `Operação ${i + 1} inválida${issue ? ` (${issue.path.join(".") || "op"}: ${issue.message})` : ""}.`,
        i,
        (ops[i] as { op?: string } | null)?.op,
      );
    }
    const op = parsed.data;
    try {
      const step = (handlers[op.op] as Handler<typeof op.op>)(cur, op as never, ctx);
      cur = step.doc;
      inverse = [...step.inverse, ...inverse];
      diffs.push(step.diff);
      applied.push(step.applied);
    } catch (err) {
      if (err instanceof DesignOpError) throw err;
      throw new DesignOpError(`Operação ${i + 1} (${op.op}) falhou: ${(err as Error).message}`, i, op.op);
    }
  }
  if (opts.validate !== false) {
    const issues = documentIssues(cur);
    if (issues.length) throw new DesignOpError(issues[0]!, ops.length - 1);
  }
  return { doc: cur, diffs, inverse, applied };
}

/** Texto curto para o histórico do editor ("Mover", "Texto alterado"…). */
export function labelOf(ops: DesignOp[]): string {
  const first = ops[0];
  if (!first) return "Alteração";
  const names: Partial<Record<DesignOpName, string>> = {
    add: "Adicionar",
    remove: "Excluir",
    update: "Editar",
    replace: "Editar",
    setText: "Editar texto",
    setStyle: "Estilo",
    transform: "Transformar",
    move: "Mover",
    resize: "Redimensionar",
    replaceImage: "Trocar imagem",
    imageFit: "Enquadrar imagem",
    crop: "Recortar imagem",
    duplicate: "Duplicar",
    reorder: "Ordem das camadas",
    reparent: "Mover camada",
    group: "Agrupar",
    ungroup: "Desagrupar",
    align: "Alinhar",
    distribute: "Distribuir",
    addPage: "Nova página",
    removePage: "Excluir página",
    updatePage: "Editar página",
    reorderPage: "Reordenar páginas",
    duplicatePage: "Duplicar página",
    changePalette: "Trocar paleta",
    createComponent: "Criar componente",
    detachInstance: "Desvincular componente",
  };
  return names[first.op] ?? "Alteração";
}
