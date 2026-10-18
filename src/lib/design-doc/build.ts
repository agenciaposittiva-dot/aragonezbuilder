import { newId } from "./ids";
import {
  DESIGN_SCHEMA,
  type DesignDocument,
  type DesignObject,
  type DesignPage,
  type EllipseObject,
  type ImageObject,
  type LineObject,
  type Paint,
  type PathObject,
  type PolygonObject,
  type RectObject,
  type TextObject,
  type TriangleObject,
} from "./schema";

/*
 * Fábricas de documentos e objetos. Usadas pelo editor, pelo servidor
 * (createDesign) e por outros módulos que geram artes (ex.: tendências → conteúdo).
 */

type Ids = { newId?: () => string };

export function createPage(
  o: { width: number; height: number; name?: string; background?: Paint; objects?: DesignObject[] } & Ids,
): DesignPage {
  return {
    id: (o.newId ?? newId)(),
    name: o.name ?? "Página 1",
    width: Math.round(o.width),
    height: Math.round(o.height),
    background: o.background ?? "#ffffff",
    objects: o.objects ?? [],
  };
}

/**
 * Documento novo com uma ou mais páginas. Carrossel: páginas conectadas, todas
 * com o tamanho da primeira.
 */
export function createDocument(
  o: {
    pages: { width: number; height: number; name?: string; background?: Paint; objects?: DesignObject[] }[];
    carousel?: boolean;
    preset?: string | null;
  } & Ids,
): DesignDocument {
  const first = o.pages[0] ?? { width: 1080, height: 1080 };
  const pages = (o.pages.length ? o.pages : [first]).map((p, i) =>
    createPage({
      ...p,
      ...(o.carousel ? { width: first.width, height: first.height } : {}),
      name: p.name ?? `Página ${i + 1}`,
      newId: o.newId,
    }),
  );
  const meta: DesignDocument["meta"] = {};
  if (o.carousel) meta.carousel = true;
  if (o.preset) meta.preset = o.preset;
  return { schema: DESIGN_SCHEMA, pages, components: [], ...(Object.keys(meta).length ? { meta } : {}) };
}

/** Documento vazio no tamanho pedido (padrão de createDesign). */
export function emptyDocument(
  width: number,
  height: number,
  opts: { pages?: number; carousel?: boolean; preset?: string | null } = {},
) {
  const n = Math.max(1, Math.min(opts.pages ?? 1, 20));
  return createDocument({
    pages: Array.from({ length: n }, () => ({ width, height })),
    carousel: opts.carousel,
    preset: opts.preset,
  });
}

/** Altura aproximada de um texto antes da medição real no editor. */
export function estimateTextHeight(t: Pick<TextObject, "text" | "fontSize" | "lineHeight" | "width" | "autoWidth">) {
  const avgChar = t.fontSize * 0.55;
  const perLine = t.autoWidth ? Infinity : Math.max(1, Math.floor(t.width / avgChar));
  const lines = t.text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.round(lines * t.fontSize * t.lineHeight * 100) / 100;
}

type Common = Partial<Pick<DesignObject, "id" | "name" | "x" | "y" | "rotation" | "opacity">> & Ids;

function common(o: Common, fallbackName: string) {
  return {
    id: o.id ?? (o.newId ?? newId)(),
    name: o.name ?? fallbackName,
    x: o.x ?? 0,
    y: o.y ?? 0,
    rotation: o.rotation ?? 0,
    opacity: o.opacity ?? 1,
  };
}

export function textObject(
  o: Common &
    Partial<Omit<TextObject, "type" | "id" | "name" | "x" | "y" | "rotation" | "opacity">> & {
      text: string;
      width: number;
    },
): TextObject {
  const { newId: _n, ...rest } = o;
  void _n;
  const t: TextObject = {
    fontFamily: "Inter",
    fontSize: 48,
    fontWeight: 400,
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
    color: "#121110",
    ...rest,
    ...common(o, "Texto"),
    type: "text",
    height: o.height ?? 0,
  };
  if (!o.height) t.height = estimateTextHeight(t);
  return t;
}

type ShapeInput<T> = Common &
  Partial<Omit<T, "type" | "id" | "name" | "x" | "y" | "rotation" | "opacity">> & {
    width: number;
    height: number;
  };

export function rectObject(o: ShapeInput<RectObject>): RectObject {
  const { newId: _n, ...rest } = o;
  void _n;
  return { fill: "#F4BF2F", ...rest, ...common(o, "Retângulo"), type: "rect" };
}

export function ellipseObject(o: ShapeInput<EllipseObject>): EllipseObject {
  const { newId: _n, ...rest } = o;
  void _n;
  return { fill: "#F4BF2F", ...rest, ...common(o, "Elipse"), type: "ellipse" };
}

export function triangleObject(o: ShapeInput<TriangleObject>): TriangleObject {
  const { newId: _n, ...rest } = o;
  void _n;
  return { fill: "#F4BF2F", ...rest, ...common(o, "Triângulo"), type: "triangle" };
}

export function polygonObject(o: ShapeInput<PolygonObject> & { sides: number }): PolygonObject {
  const { newId: _n, ...rest } = o;
  void _n;
  return {
    fill: "#F4BF2F",
    ...rest,
    ...common(o, o.innerRatio ? "Estrela" : "Polígono"),
    type: "polygon",
  };
}

export function lineObject(o: Common & Partial<Omit<LineObject, "type">> & { width: number }): LineObject {
  const { newId: _n, ...rest } = o;
  void _n;
  return {
    stroke: "#121110",
    strokeWidth: 4,
    lineCap: "round",
    ...rest,
    ...common(o, "Linha"),
    height: 0,
    type: "line",
  };
}

export function pathObject(o: ShapeInput<PathObject> & { d: string; viewBox: PathObject["viewBox"] }): PathObject {
  const { newId: _n, ...rest } = o;
  void _n;
  return { fill: null, ...rest, ...common(o, "Desenho"), type: "path" };
}

/**
 * Imagem de Arquivos: `src` é "/api/files/<versão>". Sem tamanho pedido, cabe em
 * `fitWithin` mantendo a proporção.
 */
export function imageObject(
  o: Common &
    Partial<Omit<ImageObject, "type">> & {
      src: string;
      naturalWidth: number;
      naturalHeight: number;
      fitWithin?: { width: number; height: number };
    },
): ImageObject {
  const { newId: _n, fitWithin, ...rest } = o;
  void _n;
  let width = o.width ?? o.naturalWidth;
  let height = o.height ?? o.naturalHeight;
  if (fitWithin && (!o.width || !o.height)) {
    const s = Math.min(fitWithin.width / o.naturalWidth, fitWithin.height / o.naturalHeight, 1);
    width = Math.round(o.naturalWidth * s);
    height = Math.round(o.naturalHeight * s);
  }
  return { ...rest, ...common(o, "Imagem"), type: "image", width, height, crop: o.crop ?? null };
}

/** Referência de arquivo da plataforma usada nas imagens do documento. */
export const fileSrc = (versionId: string) => `/api/files/${versionId}`;

/** Versão do arquivo referenciada por um `src` ("/api/files/<versão>"), se houver. */
export function versionIdOfSrc(src: string): string | null {
  const m = /^\/api\/files\/([0-9a-f-]{36})(?:[?#].*)?$/i.exec(src);
  return m ? m[1]!.toLowerCase() : null;
}
