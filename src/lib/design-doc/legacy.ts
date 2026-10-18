import { estimateTextHeight } from "./build";
import { normalizeRotation, rad, withGroupBox, type Point } from "./geometry";
import {
  DESIGN_SCHEMA,
  idSchema,
  type DesignDocument,
  type DesignObject,
  type FabricObjectRaw,
  type Gradient,
  type ImageObject,
  type Paint,
  type Shadow,
  type TextObject,
} from "./schema";

/*
 * Conversão do formato antigo (cena do Fabric.js, página única) para o
 * formato 2. Determinística: o mesmo documento gera sempre o mesmo resultado
 * (os ids vêm do `uid` salvo ou da posição). Nada se perde:
 * - posição, tamanho, rotação e escala viram medidas finais (a escala é
 *   incorporada a largura/altura/tamanho da fonte);
 * - propriedades sem equivalente e com valor diferente do padrão ficam em
 *   `legacy` do objeto (ou do documento, em `meta.legacy`);
 * - objetos que o formato novo não representa com exatidão (caminhos,
 *   polígonos, objetos inclinados, com filtros ou recorte) ficam intactos como
 *   tipo "fabric" e continuam sendo desenhados como antes.
 */

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Valores padrão do Fabric: propriedades iguais ao padrão não precisam ser guardadas. */
const FABRIC_DEFAULTS: Record<string, unknown> = {
  skewX: 0,
  skewY: 0,
  strokeDashOffset: 0,
  strokeLineJoin: "miter",
  strokeUniform: false,
  strokeMiterLimit: 4,
  fillRule: "nonzero",
  paintFirst: "fill",
  globalCompositeOperation: "source-over",
  backgroundColor: "",
  selectable: true,
  evented: true,
  hasControls: true,
  hasBorders: true,
  lockScalingX: false,
  lockScalingY: false,
  lockRotation: false,
  lockSkewingX: false,
  lockSkewingY: false,
  lockScalingFlip: false,
  overline: false,
  pathSide: "left",
  direction: "ltr",
  pathAlign: "baseline",
  pathStartOffset: 0,
  splitByGrapheme: false,
  minWidth: 20,
  textDecorationThickness: 66.667,
  crossOrigin: null,
  filters: [],
  startAngle: 0,
  endAngle: 360,
  counterClockwise: false,
  clipPath: undefined,
  strokeDashArray: null,
  strokeLineCap: "butt",
  styles: [],
  path: null,
  textBackgroundColor: "",
};
/** Propriedades lidas pela conversão (as demais vão para `legacy` se diferentes do padrão). */
const MAPPED = new Set([
  "type",
  "version",
  "uid",
  "name",
  "left",
  "top",
  "width",
  "height",
  "scaleX",
  "scaleY",
  "angle",
  "flipX",
  "flipY",
  "originX",
  "originY",
  "opacity",
  "visible",
  "shadow",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeUniform",
  "strokeDashArray",
  "strokeLineCap",
  "lockMovementX",
  "lockMovementY",
  "lockScalingX",
  "lockScalingY",
  "lockRotation",
  "selectable",
  "evented",
  "hasControls",
  "text",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "fontStyle",
  "lineHeight",
  "charSpacing",
  "textAlign",
  "underline",
  "linethrough",
  "textBackgroundColor",
  "styles",
  "src",
  "cropX",
  "cropY",
  "rx",
  "ry",
  "radius",
  "x1",
  "y1",
  "x2",
  "y2",
  "objects",
]);

function same(a: unknown, b: unknown) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function leftovers(raw: Raw): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (MAPPED.has(k) || v === undefined) continue;
    if (k in FABRIC_DEFAULTS ? same(v, FABRIC_DEFAULTS[k]) : v === null) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function originFactor(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v === "left" || v === "top") return 0;
  if (v === "right" || v === "bottom") return 1;
  // Fabric 7 (o editor antigo): origem padrão no centro.
  return 0.5;
}

const rotate = (p: Point, degrees: number): Point => {
  if (!degrees) return p;
  const a = rad(degrees);
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};

/** Tamanho próprio (sem escala) do objeto antigo. */
function intrinsicSize(raw: Raw, type: string): { w: number; h: number } {
  if (type === "circle") {
    const r = num(raw.radius, num(raw.width, 0) / 2);
    return { w: num(raw.width, 2 * r), h: num(raw.height, 2 * r) };
  }
  if (type === "ellipse") {
    return { w: num(raw.width, 2 * num(raw.rx, 0)), h: num(raw.height, 2 * num(raw.ry, 0)) };
  }
  if (type === "line") {
    return {
      w: num(raw.width, Math.abs(num(raw.x2, 0) - num(raw.x1, 0))),
      h: num(raw.height, Math.abs(num(raw.y2, 0) - num(raw.y1, 0))),
    };
  }
  return { w: num(raw.width, 0), h: num(raw.height, 0) };
}

/**
 * Centro do objeto no plano do pai, exatamente como o Fabric calcula
 * (origem + deslocamento até o centro usando as dimensões com contorno, girado).
 */
function fabricCenter(raw: Raw, w0: number, h0: number): Point {
  const sx = num(raw.scaleX, 1);
  const sy = num(raw.scaleY, 1);
  const sw = num(raw.strokeWidth, 1);
  const uniform = raw.strokeUniform === true;
  const dimX = uniform ? w0 * sx + sw : (w0 + sw) * sx;
  const dimY = uniform ? h0 * sy + sw : (h0 + sw) * sy;
  const off = { x: (0.5 - originFactor(raw.originX)) * dimX, y: (0.5 - originFactor(raw.originY)) * dimY };
  const r = rotate(off, num(raw.angle, 0));
  return { x: num(raw.left, 0) + r.x, y: num(raw.top, 0) + r.y };
}

function parseWeight(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return clamp(Math.round(v / 100) * 100 || 400, 100, 900);
  if (typeof v === "string") {
    if (v === "bold" || v === "bolder") return 700;
    if (v === "lighter") return 300;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return clamp(Math.round(n / 100) * 100, 100, 900);
  }
  return 400;
}

const COLOR_RE = /^[#a-zA-Z0-9(),.%\s+-]*$/;
const color = (v: unknown, d: string) => (typeof v === "string" && v.length <= 64 && COLOR_RE.test(v) ? v : d);

/** Preenchimento do Fabric (cor ou degradê) para o formato novo. */
function paintOf(v: unknown, fallback: Paint | null): { paint: Paint | null; lossy: boolean } {
  if (v === null || v === "" || v === undefined) return { paint: v === undefined ? fallback : null, lossy: false };
  if (typeof v === "string") return { paint: color(v, "#000000"), lossy: !COLOR_RE.test(v) };
  if (isObj(v) && (v.type === "linear" || v.type === "radial") && Array.isArray(v.colorStops)) {
    const stops = (v.colorStops as Raw[])
      .filter(isObj)
      .map((s) => ({ offset: clamp(num(s.offset, 0), 0, 1), color: color(s.color, "#000000") }))
      .sort((a, b) => a.offset - b.offset)
      .slice(0, 12);
    if (stops.length >= 2) {
      const c = isObj(v.coords) ? v.coords : {};
      const angle = r3((Math.atan2(num(c.y2, 0) - num(c.y1, 0), num(c.x2, 1) - num(c.x1, 0)) * 180) / Math.PI);
      const g: Gradient = v.type === "linear" ? { type: "linear", angle, stops } : { type: "radial", stops };
      return { paint: g, lossy: true };
    }
  }
  return { paint: fallback, lossy: true };
}

function shadowOf(v: unknown): Shadow | null {
  if (!isObj(v)) return null;
  return {
    color: color(v.color, "rgba(0,0,0,0.35)"),
    blur: clamp(num(v.blur, 0), 0, 1000),
    offsetX: num(v.offsetX, 0),
    offsetY: num(v.offsetY, 0),
  };
}

const DEFAULT_NAMES: Record<string, string> = {
  textbox: "Texto",
  "i-text": "Texto",
  itext: "Texto",
  text: "Texto",
  image: "Imagem",
  rect: "Retângulo",
  circle: "Círculo",
  ellipse: "Elipse",
  triangle: "Triângulo",
  line: "Linha",
  group: "Grupo",
  activeselection: "Grupo",
};

/** Endereço de arquivo da plataforma vira relativo (independe do domínio em que foi salvo). */
export function normalizeSrc(src: string) {
  const m = /^https?:\/\/[^/]+(\/api\/files\/[0-9a-f-]{36}(?:\?[^#]*)?)$/i.exec(src);
  return m ? m[1]! : src;
}

type Ctx = { ids: Set<string> };

function uniqueId(ctx: Ctx, preferred: unknown, fallback: string) {
  let id = typeof preferred === "string" && idSchema.safeParse(preferred).success ? preferred : fallback;
  if (ctx.ids.has(id)) {
    let n = 2;
    while (ctx.ids.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  ctx.ids.add(id);
  return id;
}

/** Transformação do pai (grupo antigo) aplicada a um filho. */
type Parent = { center: Point; angle: number; sx: number; sy: number };
const IDENTITY: Parent = { center: { x: 0, y: 0 }, angle: 0, sx: 1, sy: 1 };

function toParentSpace(p: Point, parent: Parent): Point {
  const s = { x: p.x * parent.sx, y: p.y * parent.sy };
  const r = rotate(s, parent.angle);
  return { x: parent.center.x + r.x, y: parent.center.y + r.y };
}

function convertObject(raw: Raw, ctx: Ctx, path: string, parent: Parent): DesignObject {
  const type = str(raw.type, "").toLowerCase();
  const sxRaw = num(raw.scaleX, 1);
  const syRaw = num(raw.scaleY, 1);
  const sx = Math.abs(sxRaw) * parent.sx;
  const sy = Math.abs(syRaw) * parent.sy;
  const { w: w0, h: h0 } = intrinsicSize(raw, type);
  const center = toParentSpace(fabricCenter(raw, w0, h0), parent);
  const rotation = r3(normalizeRotation(num(raw.angle, 0) + parent.angle));
  const width = r3(w0 * sx);
  const height = r3(h0 * sy);
  const avgScale = (sx + sy) / 2;

  const base = {
    id: uniqueId(ctx, raw.uid, `lg${path}`),
    name: str(raw.name, "").slice(0, 120) || DEFAULT_NAMES[type] || "Elemento",
    x: r3(center.x - width / 2),
    y: r3(center.y - height / 2),
    width,
    height,
    rotation,
    opacity: clamp(num(raw.opacity, 1), 0, 1),
    ...(raw.visible === false ? { hidden: true } : {}),
    ...(raw.lockMovementX === true && raw.lockMovementY === true ? { locked: true } : {}),
    ...((raw.flipX === true) !== sxRaw < 0 ? { flipX: true } : {}),
    ...((raw.flipY === true) !== syRaw < 0 ? { flipY: true } : {}),
    ...(shadowOf(raw.shadow) ? { shadow: shadowOf(raw.shadow) } : {}),
  };
  const extra = leftovers(raw);
  const withLegacy = <T extends DesignObject>(o: T, more?: Record<string, unknown>): T => {
    const bag = { ...(extra ?? {}), ...(more ?? {}) };
    return Object.keys(bag).length ? { ...o, legacy: bag } : o;
  };

  const skewed = num(raw.skewX, 0) !== 0 || num(raw.skewY, 0) !== 0;
  const clipped = raw.clipPath !== undefined && raw.clipPath !== null;
  const passthrough = (): FabricObjectRaw => ({ ...base, type: "fabric", raw });
  if (skewed || clipped) return passthrough();

  const strokeOf = () => {
    const stroke = typeof raw.stroke === "string" && raw.stroke ? color(raw.stroke, "#000000") : null;
    if (!stroke) return {};
    const sw = num(raw.strokeWidth, 1) * (raw.strokeUniform === true ? 1 : avgScale);
    return { stroke, strokeWidth: r3(sw) };
  };
  const dashOf = () =>
    Array.isArray(raw.strokeDashArray) && raw.strokeDashArray.length
      ? { strokeDash: (raw.strokeDashArray as unknown[]).map((n) => num(n, 0)).slice(0, 16) }
      : {};

  switch (type) {
    case "textbox":
    case "i-text":
    case "itext":
    case "text": {
      const fill = paintOf(raw.fill, "rgb(0,0,0)");
      const styles = raw.styles;
      const hasStyles = Array.isArray(styles) ? styles.length > 0 : isObj(styles) && Object.keys(styles).length > 0;
      const align = str(raw.textAlign, "left");
      const t: TextObject = {
        ...base,
        type: "text",
        text: str(raw.text, "").slice(0, 20_000),
        fontFamily: str(raw.fontFamily, "Times New Roman").slice(0, 80) || "Inter",
        fontSize: r3(clamp(num(raw.fontSize, 40) * sy, 1, 5000)),
        fontWeight: parseWeight(raw.fontWeight),
        fontStyle: raw.fontStyle === "italic" || raw.fontStyle === "oblique" ? "italic" : "normal",
        textAlign: align.startsWith("justify") ? "justify" : align === "center" || align === "right" ? align : "left",
        lineHeight: clamp(num(raw.lineHeight, 1.16), 0.3, 10),
        letterSpacing: clamp(num(raw.charSpacing, 0), -1000, 10_000),
        color: fill.paint ?? "rgb(0,0,0)",
        ...(raw.underline === true ? { underline: true } : {}),
        ...(raw.linethrough === true ? { linethrough: true } : {}),
        ...strokeOf(),
        ...(typeof raw.textBackgroundColor === "string" && raw.textBackgroundColor
          ? { background: color(raw.textBackgroundColor, "#ffffff") }
          : {}),
        ...(type !== "textbox" ? { autoWidth: true } : {}),
        ...(hasStyles ? { fabricStyles: styles } : {}),
      };
      if (typeof raw.height !== "number" || !t.width) {
        // Sem altura salva (documentos gerados fora do editor): estimativa, medida de verdade ao abrir.
        if (!t.width) t.width = r3(Math.max(40, num(raw.minWidth, 20) * sx, t.fontSize * 8));
        t.height = estimateTextHeight(t);
        t.x = r3(center.x - t.width / 2);
        t.y = r3(center.y - t.height / 2);
        t.measure = "center";
      }
      return withLegacy(t, fill.lossy ? { fill: raw.fill } : undefined);
    }
    case "image": {
      const filters = Array.isArray(raw.filters) && raw.filters.length > 0;
      if (filters || typeof raw.src !== "string" || !raw.src) return passthrough();
      const cropX = num(raw.cropX, 0);
      const cropY = num(raw.cropY, 0);
      const img: ImageObject = {
        ...base,
        type: "image",
        src: normalizeSrc(raw.src),
        ...(w0 > 0 && h0 > 0 && !cropX && !cropY ? { naturalWidth: w0, naturalHeight: h0 } : {}),
        crop: cropX || cropY ? { x: cropX, y: cropY, width: w0, height: h0 } : null,
        ...strokeOf(),
      };
      if (!(w0 > 0 && h0 > 0)) {
        // Tamanho desconhecido: o editor mede ao carregar a imagem.
        img.width = r3(200 * sx);
        img.height = r3(200 * sy);
        img.x = r3(center.x - img.width / 2);
        img.y = r3(center.y - img.height / 2);
      }
      return withLegacy(img);
    }
    case "rect":
    case "triangle":
    case "circle":
    case "ellipse": {
      if (type === "circle" && (num(raw.startAngle, 0) !== 0 || num(raw.endAngle, 360) !== 360)) return passthrough();
      const fill = paintOf(raw.fill, "rgb(0,0,0)");
      const style = { fill: fill.paint, ...strokeOf(), ...dashOf() };
      const more = fill.lossy ? { fill: raw.fill } : undefined;
      if (type === "rect") {
        const rx = num(raw.rx, 0);
        const ry = num(raw.ry, rx);
        const radius = r3(Math.min(rx * sx, ry * sy));
        return withLegacy({ ...base, ...style, type: "rect", ...(radius > 0 ? { radius } : {}) }, more);
      }
      if (type === "triangle") return withLegacy({ ...base, ...style, type: "triangle" }, more);
      return withLegacy({ ...base, ...style, type: "ellipse" }, more);
    }
    case "line": {
      const x1 = num(raw.x1, 0);
      const y1 = num(raw.y1, 0);
      const x2 = num(raw.x2, 0);
      const y2 = num(raw.y2, 0);
      const xMult = x1 <= x2 ? -1 : 1;
      const yMult = y1 <= y2 ? -1 : 1;
      const fx = (raw.flipX === true ? -1 : 1) * Math.sign(sxRaw || 1);
      const fy = (raw.flipY === true ? -1 : 1) * Math.sign(syRaw || 1);
      const local = (px: number, py: number) => {
        const p = rotate({ x: px * sx * fx, y: py * sy * fy }, rotation);
        return { x: center.x + p.x, y: center.y + p.y };
      };
      const p1 = local((xMult * w0) / 2, (yMult * h0) / 2);
      const p2 = local((-xMult * w0) / 2, (-yMult * h0) / 2);
      const length = r3(Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const angle = r3(normalizeRotation((Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI));
      // Espessura: o traço escala na direção perpendicular à linha.
      const dl = Math.hypot(x2 - x1, y2 - y1) || 1;
      const n = { x: -(y2 - y1) / dl, y: (x2 - x1) / dl };
      const thick = raw.strokeUniform === true ? 1 : Math.hypot(sx * n.x, sy * n.y);
      const { flipX: _fx, flipY: _fy, ...lineBase } = base;
      void _fx;
      void _fy;
      return withLegacy({
        ...lineBase,
        type: "line",
        x: r3(center.x - length / 2),
        y: r3(center.y),
        width: length,
        height: 0,
        rotation: angle,
        stroke: color(raw.stroke, "rgb(0,0,0)"),
        strokeWidth: r3(num(raw.strokeWidth, 1) * thick),
        ...dashOf(),
        ...(raw.strokeLineCap === "round" || raw.strokeLineCap === "square" ? { lineCap: raw.strokeLineCap } : {}),
      });
    }
    case "group":
    case "activeselection": {
      const children = Array.isArray(raw.objects) ? (raw.objects as unknown[]).filter(isObj) : [];
      if (!children.length) return passthrough();
      // Filhos do Fabric são relativos ao centro do grupo, no plano já escalado e girado.
      const p: Parent = { center, angle: rotation, sx, sy };
      const list = children.map((c, i) => convertObject(c, ctx, `${path}_${i}`, p));
      const g = withGroupBox({ ...base, type: "group" as const, children: list, rotation: 0 });
      return withLegacy(g);
    }
    default:
      return passthrough();
  }
}

export type LegacyConversion = { doc: DesignDocument; passthrough: number; estimatedTexts: number };

/**
 * Converte uma cena antiga do Fabric (`{ version, objects, background }`) num
 * documento de uma página no tamanho da arte.
 */
export function convertLegacyDocument(raw: unknown, size: { width: number; height: number }): LegacyConversion {
  const src = isObj(raw) ? raw : {};
  const ctx: Ctx = { ids: new Set(["p1"]) };
  const objects = (Array.isArray(src.objects) ? (src.objects as unknown[]) : [])
    .filter(isObj)
    .map((o, i) => convertObject(o, ctx, String(i), IDENTITY));
  const bg = paintOf(src.background, "#ffffff");
  const docLegacy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "objects" || k === "background" || v === undefined || v === null) continue;
    docLegacy[k] = v;
  }
  if (bg.lossy) docLegacy.background = src.background;
  let passthrough = 0;
  let estimatedTexts = 0;
  const count = (list: DesignObject[]) => {
    for (const o of list) {
      if (o.type === "fabric") passthrough++;
      if (o.type === "text" && o.measure) estimatedTexts++;
      if (o.type === "group") count(o.children);
    }
  };
  count(objects);
  const doc: DesignDocument = {
    schema: DESIGN_SCHEMA,
    pages: [
      {
        id: "p1",
        name: "Página 1",
        width: clamp(Math.round(size.width), 16, 10_000),
        height: clamp(Math.round(size.height), 16, 10_000),
        background: bg.paint ?? "transparent",
        objects,
      },
    ],
    components: [],
    meta: { migratedFrom: "fabric", ...(Object.keys(docLegacy).length ? { legacy: docLegacy } : {}) },
  };
  return { doc, passthrough, estimatedTexts };
}

/** Parece uma cena antiga do Fabric (ou um documento vazio)? */
export function isLegacyDocument(raw: unknown) {
  if (!isObj(raw)) return false;
  if (raw.schema !== undefined) return false;
  return raw.objects === undefined || Array.isArray(raw.objects);
}
