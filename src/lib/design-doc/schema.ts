import { z } from "zod";

/*
 * Documento editável do Estúdio (formato 2).
 *
 * Separação (pedido 1.3):
 * - documento → páginas (pranchetas) → objetos gráficos;
 * - assets: imagens são arquivos da plataforma (Arquivos), referenciados por
 *   `src: "/api/files/<versão>"` — nada pesado fica dentro do documento;
 * - componentes reutilizáveis (`components`) e estilos salvos (`styles`);
 * - histórico: versões no servidor (design_versions) e desfazer/refazer por
 *   operações no editor — fora do documento;
 * - estado temporário da interface (seleção, zoom, ferramenta) nunca é salvo.
 *
 * Coordenadas: pixels da página, origem no canto superior esquerdo. `x`/`y` são
 * o canto superior esquerdo da caixa SEM rotação; `rotation` (graus, horário)
 * gira em torno do centro da caixa. Filhos de grupo usam as mesmas coordenadas
 * da página (o grupo é a caixa que envolve os filhos, sem transformação própria).
 */

export const DESIGN_SCHEMA = "aragonez.design/2" as const;

export const DESIGN_LIMITS = {
  pages: 100,
  objectsPerPage: 2000,
  totalObjects: 10_000,
  groupDepth: 8,
  components: 200,
  text: 20_000,
  name: 120,
  pathLength: 400_000,
  srcLength: 8_000_000,
  guides: 100,
} as const;

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type GradientStop = { offset: number; color: string };
export type Gradient = {
  type: "linear" | "radial";
  /** Linear: direção em graus (0 = da esquerda para a direita, 90 = de cima para baixo). */
  angle?: number;
  stops: GradientStop[];
};
/** Cor sólida (hex, rgb/rgba, hsl, nome) ou degradê. */
export type Paint = string | Gradient;
export type Shadow = { color: string; blur: number; offsetX: number; offsetY: number };
export type Crop = { x: number; y: number; width: number; height: number };

type Base = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked?: boolean;
  hidden?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  shadow?: Shadow | null;
  /** Propriedades do formato antigo sem equivalente (preservadas na migração). */
  legacy?: Record<string, unknown>;
};

export type TextObject = Base & {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: number;
  /** Espaçamento entre letras em milésimos de em (100 = 0,1 em). */
  letterSpacing: number;
  color: Paint;
  underline?: boolean;
  linethrough?: boolean;
  stroke?: string | null;
  strokeWidth?: number;
  background?: string | null;
  /** Largura ajusta ao texto (sem quebra automática de linha). */
  autoWidth?: boolean;
  /** Estilos por caractere herdados do formato antigo (mantidos até o texto ser trocado). */
  fabricStyles?: unknown;
  /** Migração sem altura medida: o editor mede e mantém o centro vertical. */
  measure?: "center";
};

export type ImageObject = Base & {
  type: "image";
  /** "/api/files/<versão>" (arquivo da plataforma) ou data URL de documentos antigos. */
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
  /** Recorte em pixels da imagem original; null/ausente = imagem inteira. */
  crop?: Crop | null;
  radius?: number;
  stroke?: string | null;
  strokeWidth?: number;
};

type ShapeStyle = {
  fill: Paint | null;
  stroke?: string | null;
  strokeWidth?: number;
  strokeDash?: number[] | null;
};

export type RectObject = Base & ShapeStyle & { type: "rect"; radius?: number };
export type EllipseObject = Base & ShapeStyle & { type: "ellipse" };
export type TriangleObject = Base & ShapeStyle & { type: "triangle" };
export type PolygonObject = Base &
  ShapeStyle & {
    type: "polygon";
    sides: number;
    /** Estrela: raio interno relativo (0–1). Ausente = polígono regular. */
    innerRatio?: number | null;
  };

export type LineObject = Base & {
  type: "line";
  /** A linha vai do meio da borda esquerda ao meio da direita da caixa (comprimento = width). */
  stroke: string;
  strokeWidth: number;
  strokeDash?: number[] | null;
  lineCap?: "butt" | "round" | "square";
};

export type PathObject = Base &
  ShapeStyle & {
    type: "path";
    /** Dados SVG do caminho no sistema de `viewBox`. */
    d: string;
    viewBox: [number, number, number, number];
    lineCap?: "butt" | "round" | "square";
    lineJoin?: "miter" | "round" | "bevel";
  };

export type GroupObject = Base & { type: "group"; children: DesignObject[] };

export type InstanceOverride = {
  text?: string;
  src?: string;
  color?: Paint;
  fill?: Paint | null;
  hidden?: boolean;
};
export type InstanceObject = Base & {
  type: "instance";
  componentId: string;
  /** Alterações locais por objeto do componente (por id). */
  overrides?: Record<string, InstanceOverride>;
};

/** Objeto antigo sem equivalente exato: guardado intacto e desenhado como era. */
export type FabricObjectRaw = Base & { type: "fabric"; raw: Record<string, unknown> };

export type DesignObject =
  | TextObject
  | ImageObject
  | RectObject
  | EllipseObject
  | TriangleObject
  | PolygonObject
  | LineObject
  | PathObject
  | GroupObject
  | InstanceObject
  | FabricObjectRaw;

export type DesignObjectType = DesignObject["type"];

export type Guides = { v: number[]; h: number[] };

export type DesignPage = {
  id: string;
  name: string;
  width: number;
  height: number;
  background: Paint;
  objects: DesignObject[];
  guides?: Guides;
};

export type DesignComponent = {
  id: string;
  name: string;
  width: number;
  height: number;
  objects: DesignObject[];
};

export type TextStyle = {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  color: Paint;
};
export type ColorStyle = { id: string; name: string; value: string };

export type DesignMeta = {
  /** Formato escolhido na criação (ver presets). */
  preset?: string | null;
  /** Carrossel: páginas conectadas (mesmo tamanho, conteúdo pode continuar de uma página para a outra). */
  carousel?: boolean;
  /** Origem do documento quando convertido do formato antigo. */
  migratedFrom?: "fabric";
  /** Propriedades do documento antigo sem equivalente. */
  legacy?: Record<string, unknown>;
  /**
   * Arquivos gerados na última exportação para Arquivos, por página (id da
   * página → id do arquivo): o próximo envio vira nova versão do mesmo arquivo.
   */
  outputs?: Record<string, string>;
  /** Arquivo PDF da última exportação para Arquivos. */
  pdfOutputFileId?: string | null;
};

export type DesignDocument = {
  schema: typeof DESIGN_SCHEMA;
  pages: DesignPage[];
  components: DesignComponent[];
  styles?: { colors?: ColorStyle[]; text?: TextStyle[] };
  meta?: DesignMeta;
};

/* ------------------------------------------------------------------ */
/* Validação                                                           */
/* ------------------------------------------------------------------ */

const finite = z.number().refine(Number.isFinite, "Número inválido");
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Identificador inválido");
/** Cores CSS simples (sem url(), sem expressões). */
export const colorSchema = z
  .string()
  .max(64)
  .regex(/^[#a-zA-Z0-9(),.%\s+-]*$/, "Cor inválida");

export const gradientSchema: z.ZodType<Gradient> = z.object({
  type: z.enum(["linear", "radial"]),
  angle: finite.optional(),
  stops: z
    .array(z.object({ offset: z.number().min(0).max(1), color: colorSchema }))
    .min(2)
    .max(12),
});
export const paintSchema: z.ZodType<Paint> = z.union([colorSchema, gradientSchema]);
export const shadowSchema: z.ZodType<Shadow> = z.object({
  color: colorSchema,
  blur: z.number().min(0).max(1000),
  offsetX: finite,
  offsetY: finite,
});
const dim = z.number().min(0).max(1_000_000).refine(Number.isFinite, "Número inválido");
const strokeWidth = z.number().min(0).max(10_000);
const dash = z.array(z.number().min(0).max(10_000)).max(16).nullable().optional();

const base = {
  id: idSchema,
  name: z.string().max(DESIGN_LIMITS.name),
  x: finite,
  y: finite,
  width: dim,
  height: dim,
  rotation: finite,
  opacity: z.number().min(0).max(1),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  shadow: shadowSchema.nullable().optional(),
  legacy: z.record(z.string(), z.unknown()).optional(),
};
const shape = {
  fill: paintSchema.nullable(),
  stroke: colorSchema.nullable().optional(),
  strokeWidth: strokeWidth.optional(),
  strokeDash: dash,
};

export const textObjectSchema = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string().max(DESIGN_LIMITS.text),
  fontFamily: z.string().min(1).max(80),
  fontSize: z.number().min(1).max(5000),
  fontWeight: z.number().int().min(100).max(1000),
  fontStyle: z.enum(["normal", "italic"]),
  textAlign: z.enum(["left", "center", "right", "justify"]),
  lineHeight: z.number().min(0.3).max(10),
  letterSpacing: z.number().min(-1000).max(10_000),
  color: paintSchema,
  underline: z.boolean().optional(),
  linethrough: z.boolean().optional(),
  stroke: colorSchema.nullable().optional(),
  strokeWidth: strokeWidth.optional(),
  background: colorSchema.nullable().optional(),
  autoWidth: z.boolean().optional(),
  fabricStyles: z.unknown().optional(),
  measure: z.literal("center").optional(),
});

const cropSchema = z.object({ x: dim, y: dim, width: dim, height: dim });

export const imageObjectSchema = z.object({
  ...base,
  type: z.literal("image"),
  src: z
    .string()
    .min(1)
    .max(DESIGN_LIMITS.srcLength)
    .refine((s) => !/^\s*javascript:/i.test(s), "Endereço de imagem inválido"),
  naturalWidth: dim.optional(),
  naturalHeight: dim.optional(),
  crop: cropSchema.nullable().optional(),
  radius: dim.optional(),
  stroke: colorSchema.nullable().optional(),
  strokeWidth: strokeWidth.optional(),
});

export const rectObjectSchema = z.object({ ...base, ...shape, type: z.literal("rect"), radius: dim.optional() });
export const ellipseObjectSchema = z.object({ ...base, ...shape, type: z.literal("ellipse") });
export const triangleObjectSchema = z.object({ ...base, ...shape, type: z.literal("triangle") });
export const polygonObjectSchema = z.object({
  ...base,
  ...shape,
  type: z.literal("polygon"),
  sides: z.number().int().min(3).max(64),
  innerRatio: z.number().min(0.05).max(0.99).nullable().optional(),
});
export const lineObjectSchema = z.object({
  ...base,
  type: z.literal("line"),
  stroke: colorSchema,
  strokeWidth: strokeWidth,
  strokeDash: dash,
  lineCap: z.enum(["butt", "round", "square"]).optional(),
});
export const pathObjectSchema = z.object({
  ...base,
  ...shape,
  type: z.literal("path"),
  d: z
    .string()
    .max(DESIGN_LIMITS.pathLength)
    .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/, "Caminho inválido"),
  viewBox: z.tuple([finite, finite, dim, dim]),
  lineCap: z.enum(["butt", "round", "square"]).optional(),
  lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
});
const overrideSchema = z.object({
  text: z.string().max(DESIGN_LIMITS.text).optional(),
  src: z.string().max(DESIGN_LIMITS.srcLength).optional(),
  color: paintSchema.optional(),
  fill: paintSchema.nullable().optional(),
  hidden: z.boolean().optional(),
});
export const instanceObjectSchema = z.object({
  ...base,
  type: z.literal("instance"),
  componentId: idSchema,
  overrides: z.record(idSchema, overrideSchema).optional(),
});
export const fabricObjectSchema = z.object({
  ...base,
  type: z.literal("fabric"),
  raw: z.record(z.string(), z.unknown()),
});

export const groupObjectSchema = z.object({
  ...base,
  type: z.literal("group"),
  get children(): z.ZodArray<z.ZodType<DesignObject>> {
    return z.array(designObjectSchema);
  },
});

export const designObjectSchema: z.ZodType<DesignObject> = z.lazy(() =>
  z.discriminatedUnion("type", [
    textObjectSchema,
    imageObjectSchema,
    rectObjectSchema,
    ellipseObjectSchema,
    triangleObjectSchema,
    polygonObjectSchema,
    lineObjectSchema,
    pathObjectSchema,
    groupObjectSchema,
    instanceObjectSchema,
    fabricObjectSchema,
  ]),
) as z.ZodType<DesignObject>;

const pageSize = z.number().int().min(16).max(10_000);
export const guidesSchema: z.ZodType<Guides> = z.object({
  v: z.array(finite).max(DESIGN_LIMITS.guides),
  h: z.array(finite).max(DESIGN_LIMITS.guides),
});

export const designPageSchema: z.ZodType<DesignPage> = z.object({
  id: idSchema,
  name: z.string().max(80),
  width: pageSize,
  height: pageSize,
  background: paintSchema,
  objects: z.array(designObjectSchema).max(DESIGN_LIMITS.objectsPerPage),
  guides: guidesSchema.optional(),
});

export const designComponentSchema: z.ZodType<DesignComponent> = z.object({
  id: idSchema,
  name: z.string().max(DESIGN_LIMITS.name),
  width: dim,
  height: dim,
  objects: z.array(designObjectSchema).max(DESIGN_LIMITS.objectsPerPage),
});

const textStyleSchema: z.ZodType<TextStyle> = z.object({
  id: idSchema,
  name: z.string().max(80),
  fontFamily: z.string().min(1).max(80),
  fontSize: z.number().min(1).max(5000),
  fontWeight: z.number().int().min(100).max(1000),
  lineHeight: z.number().min(0.3).max(10),
  letterSpacing: z.number().min(-1000).max(10_000),
  color: paintSchema,
});
const colorStyleSchema: z.ZodType<ColorStyle> = z.object({
  id: idSchema,
  name: z.string().max(80),
  value: colorSchema,
});

export const designMetaSchema: z.ZodType<DesignMeta> = z.object({
  preset: z.string().max(60).nullable().optional(),
  carousel: z.boolean().optional(),
  migratedFrom: z.literal("fabric").optional(),
  legacy: z.record(z.string(), z.unknown()).optional(),
  outputs: z.record(idSchema, z.uuid()).optional(),
  pdfOutputFileId: z.uuid().nullable().optional(),
});

export const designDocumentSchema: z.ZodType<DesignDocument> = z.object({
  schema: z.literal(DESIGN_SCHEMA),
  pages: z.array(designPageSchema).min(1).max(DESIGN_LIMITS.pages),
  components: z.array(designComponentSchema).max(DESIGN_LIMITS.components),
  styles: z
    .object({
      colors: z.array(colorStyleSchema).max(200).optional(),
      text: z.array(textStyleSchema).max(200).optional(),
    })
    .optional(),
  meta: designMetaSchema.optional(),
});

export function isDesignDocument(doc: unknown): doc is DesignDocument {
  return !!doc && typeof doc === "object" && (doc as { schema?: unknown }).schema === DESIGN_SCHEMA;
}

/* ------------------------------------------------------------------ */
/* Regras do documento inteiro                                         */
/* ------------------------------------------------------------------ */

/**
 * Regras que o esquema sozinho não expressa: identificadores únicos, componentes
 * existentes e sem ciclos, profundidade de grupos e páginas de mesmo tamanho no
 * carrossel. Devolve a lista de problemas (vazia = válido).
 */
export function documentIssues(doc: DesignDocument): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const seen = (id: string, what: string) => {
    if (ids.has(id)) issues.push(`Identificador repetido: ${id} (${what}).`);
    ids.add(id);
  };
  let total = 0;
  const componentIds = new Set(doc.components.map((c) => c.id));
  const walk = (list: DesignObject[], depth: number, insideComponent: string | null) => {
    if (depth > DESIGN_LIMITS.groupDepth) issues.push("Grupos aninhados demais.");
    for (const o of list) {
      total++;
      seen(o.id, "objeto");
      if (o.type === "group") walk(o.children, depth + 1, insideComponent);
      if (o.type === "instance") {
        if (!componentIds.has(o.componentId)) issues.push(`Componente inexistente: ${o.componentId}.`);
        if (insideComponent && componentUses(doc, o.componentId, insideComponent))
          issues.push(`Componente que contém a si mesmo: ${insideComponent}.`);
      }
    }
  };
  for (const p of doc.pages) {
    seen(p.id, "página");
    walk(p.objects, 0, null);
  }
  for (const c of doc.components) {
    seen(c.id, "componente");
    walk(c.objects, 0, c.id);
  }
  if (total > DESIGN_LIMITS.totalObjects)
    issues.push(`Objetos demais no documento (máx. ${DESIGN_LIMITS.totalObjects}).`);
  if (doc.meta?.carousel) {
    const [first] = doc.pages;
    if (first && doc.pages.some((p) => p.width !== first.width || p.height !== first.height))
      issues.push("No carrossel todas as páginas têm o mesmo tamanho.");
  }
  return issues;
}

/** O componente `id` usa (direta ou indiretamente) o componente `target`? */
function componentUses(doc: DesignDocument, id: string, target: string, seen = new Set<string>()): boolean {
  if (id === target) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  const comp = doc.components.find((c) => c.id === id);
  if (!comp) return false;
  let found = false;
  const walk = (list: DesignObject[]) => {
    for (const o of list) {
      if (found) return;
      if (o.type === "instance" && componentUses(doc, o.componentId, target, seen)) found = true;
      if (o.type === "group") walk(o.children);
    }
  };
  walk(comp.objects);
  return found;
}

export class DesignDocumentError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "DesignDocumentError";
  }
}

/** Valida o documento inteiro (esquema + regras). Lança DesignDocumentError. */
export function parseDesignDocument(raw: unknown): DesignDocument {
  const res = designDocumentSchema.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "documento"}: ${i.message}`);
    throw new DesignDocumentError("Documento da arte inválido.", issues);
  }
  const issues = documentIssues(res.data);
  if (issues.length) throw new DesignDocumentError("Documento da arte inválido.", issues);
  return res.data;
}
