"use client";

import type * as FabricNS from "fabric";
import {
  instanceChildren,
  type DesignDocument,
  type DesignObject,
  type Paint,
  type PathObject,
  type PolygonObject,
} from "@/lib/design-doc";
import { loadedImage, loadImage } from "./media";

/*
 * Desenho do documento com o Fabric. Cada objeto do documento vira um objeto
 * do Fabric sem escala (medidas finais), posicionado pelo centro. Grupos e
 * instâncias de componentes viram grupos do Fabric (movem como uma peça);
 * um grupo aberto (duplo clique) tem os filhos desenhados um a um.
 */

export type Fabric = typeof FabricNS;
export type FObj = FabricNS.FabricObject & {
  __id?: string;
  __pageId?: string;
  __bounds?: boolean;
  /** Objeto provisório (imagem ainda carregando, elemento antigo sendo montado). */
  __pending?: boolean;
  __w0?: number;
  __h0?: number;
  __sx0?: number;
  __sy0?: number;
};

export type RenderContext = {
  fabric: Fabric;
  doc: DesignDocument;
  /** Canto superior esquerdo da página no espaço do canvas. */
  offset: { x: number; y: number };
  pageId: string;
  /** Opacidade herdada dos grupos acima (multiplica a do objeto). */
  opacity: number;
  hidden: boolean;
  locked: boolean;
  interactive: boolean;
};

const EDITOR_CONTROLS = {
  borderColor: "#d9a21a",
  cornerColor: "#ffffff",
  cornerStrokeColor: "#d9a21a",
  cornerStyle: "circle" as const,
  transparentCorners: false,
  cornerSize: 10,
  touchCornerSize: 28,
  borderScaleFactor: 1.5,
  lockScalingFlip: true,
};

export function setupFabricDefaults(fabric: Fabric) {
  Object.assign(fabric.FabricObject.ownDefaults, EDITOR_CONTROLS);
}

/** Cor ou degradê do documento para o Fabric (degradê em coordenadas relativas ao objeto). */
export type FabricFill = string | FabricNS.Gradient<"linear", "linear"> | FabricNS.Gradient<"radial", "radial">;

export function toFabricPaint(fabric: Fabric, paint: Paint | null | undefined): FabricFill | null {
  if (!paint) return null;
  if (typeof paint === "string") return paint;
  if (paint.type === "radial") {
    return new fabric.Gradient<"radial", "radial">({
      type: "radial",
      gradientUnits: "percentage",
      coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 },
      colorStops: paint.stops.map((s) => ({ offset: s.offset, color: s.color })),
    });
  }
  const a = ((paint.angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(a) / 2;
  const dy = Math.sin(a) / 2;
  return new fabric.Gradient<"linear", "linear">({
    type: "linear",
    gradientUnits: "percentage",
    coords: { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy },
    colorStops: paint.stops.map((s) => ({ offset: s.offset, color: s.color })),
  });
}

function baseProps(o: DesignObject, ctx: RenderContext) {
  const shadow = o.shadow ? new ctx.fabric.Shadow({ ...o.shadow }) : null;
  const selectable = ctx.interactive && !ctx.locked && !o.locked;
  return {
    left: ctx.offset.x + o.x + o.width / 2,
    top: ctx.offset.y + o.y + o.height / 2,
    originX: "center" as const,
    originY: "center" as const,
    angle: o.rotation,
    opacity: o.opacity * ctx.opacity,
    visible: !(ctx.hidden || o.hidden),
    flipX: !!o.flipX,
    flipY: !!o.flipY,
    shadow,
    selectable,
    evented: selectable,
    hoverCursor: selectable ? "move" : "default",
    strokeUniform: true,
    // Formas e textos sem sombra desenham mais rápido direto: o cache do Fabric usa bitmaps de no mínimo
    // 256 px por objeto, caros de redesenhar girados quando o navegador não tem aceleração de vídeo.
    objectCaching: !SIMPLE.has(o.type) || !!o.shadow,
  };
}

const SIMPLE = new Set(["rect", "ellipse", "triangle", "polygon", "line", "text"]);

const SERIF = /serif|playfair|merriweather|lora|georgia|times|garamond|baskerville|bodoni|cormorant|crimson/i;

/** Família com alternativa genérica: sem a fonte, o navegador usa uma parecida (sem serifa ou com serifa). */
export function cssFontFamily(family: string) {
  const clean = family.replace(/["',]/g, "").trim() || "Inter";
  return `"${clean}", ${SERIF.test(clean) && !/sans/i.test(clean) ? "serif" : "sans-serif"}`;
}

/** Pontos de polígono/estrela que preenchem exatamente a caixa (o Fabric centraliza pela caixa dos pontos). */
export function polygonPoints(o: Pick<PolygonObject, "sides" | "innerRatio" | "width" | "height">) {
  const n = Math.max(3, o.sides);
  const star = !!o.innerRatio;
  const count = star ? n * 2 : n;
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = star && i % 2 === 1 ? o.innerRatio! : 1;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    raw.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  const minX = Math.min(...raw.map((p) => p.x));
  const maxX = Math.max(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  const maxY = Math.max(...raw.map((p) => p.y));
  return raw.map((p) => ({
    x: ((p.x - minX) / (maxX - minX || 1)) * o.width,
    y: ((p.y - minY) / (maxY - minY || 1)) * o.height,
  }));
}

/** Marca o objeto com o id do documento e guarda as medidas de origem (para ler a transformação depois). */
function tag<T extends FObj>(obj: T, o: DesignObject, ctx: RenderContext): T {
  obj.__id = o.id;
  obj.__pageId = ctx.pageId;
  obj.__w0 = o.width;
  obj.__h0 = o.height;
  obj.__sx0 = obj.scaleX || 1;
  obj.__sy0 = obj.scaleY || 1;
  return obj;
}

/** Objeto do Fabric para um objeto do documento (grupos fechados viram um grupo do Fabric). */
export function createFabricObject(o: DesignObject, ctx: RenderContext): FObj {
  const { fabric } = ctx;
  const base = baseProps(o, ctx);
  switch (o.type) {
    case "text": {
      const textProps = {
        ...base,
        ...(o.autoWidth ? {} : { width: Math.max(1, o.width) }),
        fontFamily: cssFontFamily(o.fontFamily),
        fontSize: o.fontSize,
        fontWeight: o.fontWeight,
        fontStyle: o.fontStyle,
        textAlign: o.textAlign,
        lineHeight: o.lineHeight,
        charSpacing: o.letterSpacing,
        fill: toFabricPaint(fabric, o.color) ?? "#000000",
        underline: !!o.underline,
        linethrough: !!o.linethrough,
        stroke: o.stroke ?? null,
        strokeWidth: o.stroke ? (o.strokeWidth ?? 1) : 0,
        textBackgroundColor: o.background ?? "",
        ...(o.fabricStyles ? { styles: o.fabricStyles as never } : {}),
        // O centro vem da altura do documento; a altura real é medida e corrigida em seguida.
        top: ctx.offset.y + o.y + o.height / 2,
        splitByGrapheme: false,
        editable: base.selectable,
      };
      const t = (o.autoWidth ? new fabric.IText(o.text, textProps) : new fabric.Textbox(o.text, textProps)) as FObj;
      if (!o.autoWidth) t.setControlsVisibility({ mt: false, mb: false });
      return tag(t, o, ctx);
    }
    case "image": {
      const loaded = loadedImage(o.src);
      if (!loaded) {
        // Ainda carregando: um retângulo neutro no lugar até a imagem chegar.
        const ph = new fabric.Rect({
          ...base,
          width: o.width,
          height: o.height,
          fill: "#e9e7e1",
          strokeWidth: 0,
        }) as FObj;
        ph.__pending = true;
        void loadImage(o.src);
        return tag(ph, o, ctx);
      }
      const el = loaded.el;
      const nw = el.naturalWidth || o.naturalWidth || o.width;
      const nh = el.naturalHeight || o.naturalHeight || o.height;
      const crop = loaded.missing ? null : o.crop;
      const cw = Math.max(1, crop?.width ?? nw);
      const ch = Math.max(1, crop?.height ?? nh);
      const img = new fabric.FabricImage(el, {
        ...base,
        cropX: crop?.x ?? 0,
        cropY: crop?.y ?? 0,
        width: cw,
        height: ch,
        scaleX: o.width / cw,
        scaleY: o.height / ch,
        stroke: o.stroke ?? null,
        strokeWidth: o.stroke ? (o.strokeWidth ?? 1) : 0,
      }) as FObj;
      if (o.radius) {
        img.clipPath = new fabric.Rect({
          width: cw,
          height: ch,
          rx: o.radius / (o.width / cw),
          ry: o.radius / (o.height / ch),
          originX: "center",
          originY: "center",
        });
      }
      return tag(img, o, ctx);
    }
    case "rect":
    case "ellipse":
    case "triangle":
    case "polygon": {
      const style = {
        fill: toFabricPaint(fabric, o.fill) ?? "",
        stroke: o.stroke ?? null,
        strokeWidth: o.stroke ? (o.strokeWidth ?? 1) : 0,
        strokeDashArray: o.strokeDash?.length ? o.strokeDash : null,
      };
      let shape: FObj;
      if (o.type === "rect") {
        const r = Math.min(o.radius ?? 0, o.width / 2, o.height / 2);
        shape = new fabric.Rect({ ...base, ...style, width: o.width, height: o.height, rx: r, ry: r }) as FObj;
      } else if (o.type === "ellipse") {
        shape = new fabric.Ellipse({ ...base, ...style, rx: o.width / 2, ry: o.height / 2 }) as FObj;
      } else if (o.type === "triangle") {
        shape = new fabric.Triangle({ ...base, ...style, width: o.width, height: o.height }) as FObj;
      } else {
        shape = new fabric.Polygon(polygonPoints(o), { ...base, ...style, strokeLineJoin: "round" }) as FObj;
        shape.set({ left: base.left, top: base.top });
      }
      return tag(shape, o, ctx);
    }
    case "line": {
      const line = new fabric.Line([-o.width / 2, 0, o.width / 2, 0], {
        ...base,
        stroke: o.stroke,
        strokeWidth: o.strokeWidth,
        strokeLineCap: o.lineCap ?? "butt",
        strokeDashArray: o.strokeDash?.length ? o.strokeDash : null,
        strokeUniform: false,
        padding: 6,
      }) as FObj;
      line.set({ left: base.left, top: base.top });
      line.setControlsVisibility({ mt: false, mb: false, tl: false, tr: false, bl: false, br: false });
      return tag(line, o, ctx);
    }
    case "path":
      return tag(createPath(o, ctx, base), o, ctx);
    case "group": {
      const kids = o.children.map((c) =>
        createFabricObject(c, { ...ctx, opacity: 1, hidden: false, locked: false, interactive: false }),
      );
      const g = new fabric.Group(kids, {
        opacity: o.opacity * ctx.opacity,
        visible: !(ctx.hidden || o.hidden),
        selectable: base.selectable,
        evented: base.selectable,
        subTargetCheck: false,
        interactive: false,
        hoverCursor: base.hoverCursor,
      }) as FObj;
      return tag(g, o, ctx);
    }
    case "instance": {
      const children = instanceChildren(ctx.doc, o);
      const inner = {
        ...ctx,
        offset: { x: ctx.offset.x + o.x, y: ctx.offset.y + o.y },
        opacity: 1,
        hidden: false,
        locked: false,
        interactive: false,
      };
      const bounds = new fabric.Rect({
        left: inner.offset.x + o.width / 2,
        top: inner.offset.y + o.height / 2,
        originX: "center",
        originY: "center",
        width: Math.max(1, o.width),
        height: Math.max(1, o.height),
        fill: "rgba(0,0,0,0)",
        strokeWidth: 0,
      }) as FObj;
      bounds.__bounds = true;
      const g = new fabric.Group([bounds, ...children.map((c) => createFabricObject(c, inner))], {
        opacity: o.opacity * ctx.opacity,
        visible: !(ctx.hidden || o.hidden),
        selectable: base.selectable,
        evented: base.selectable,
        subTargetCheck: false,
        interactive: false,
        hoverCursor: base.hoverCursor,
        flipX: !!o.flipX,
        flipY: !!o.flipY,
      }) as FObj;
      g.set({ angle: o.rotation });
      return tag(g, o, ctx);
    }
    case "fabric": {
      // Elemento antigo: montado de forma assíncrona; até lá, um contorno no lugar.
      const ph = new fabric.Rect({
        ...base,
        width: o.width,
        height: o.height,
        fill: "rgba(0,0,0,0.04)",
        strokeWidth: 0,
      }) as FObj;
      ph.__pending = true;
      return tag(ph, o, ctx);
    }
  }
}

function createPath(o: PathObject, ctx: RenderContext, base: ReturnType<typeof baseProps>): FObj {
  const { fabric } = ctx;
  const [vx, vy, vw, vh] = o.viewBox;
  const path = new fabric.Path(o.d || "M 0 0", {
    fill: toFabricPaint(fabric, o.fill) ?? "",
    stroke: o.stroke ?? null,
    strokeWidth: o.stroke ? (o.strokeWidth ?? 1) : 0,
    strokeLineCap: o.lineCap ?? "round",
    strokeLineJoin: o.lineJoin ?? "round",
    strokeDashArray: o.strokeDash?.length ? o.strokeDash : null,
  }) as FObj & { pathOffset: FabricNS.Point };
  const sx = vw > 0 ? o.width / vw : 1;
  const sy = vh > 0 ? o.height / vh : 1;
  // O centro do objeto corresponde ao centro do viewBox; o Fabric posiciona pelo centro do próprio caminho.
  const off = { x: (path.pathOffset.x - (vx + vw / 2)) * sx, y: (path.pathOffset.y - (vy + vh / 2)) * sy };
  const a = (o.rotation * Math.PI) / 180;
  const rot = { x: off.x * Math.cos(a) - off.y * Math.sin(a), y: off.x * Math.sin(a) + off.y * Math.cos(a) };
  path.set({ ...base, scaleX: sx, scaleY: sy, left: base.left + rot.x, top: base.top + rot.y });
  return path;
}

/** Monta um elemento antigo (tipo "fabric") com o próprio Fabric, no lugar e sem permitir escala. */
export async function enlivenLegacy(
  o: Extract<DesignObject, { type: "fabric" }>,
  ctx: RenderContext,
): Promise<FObj | null> {
  try {
    const [obj] = (await ctx.fabric.util.enlivenObjects([o.raw])) as FObj[];
    if (!obj) return null;
    const base = baseProps(o, ctx);
    obj.set({
      opacity: base.opacity,
      visible: base.visible,
      selectable: base.selectable,
      evented: base.selectable,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      hasControls: false,
    });
    obj.setPositionByOrigin(new ctx.fabric.Point(base.left, base.top), "center", "center");
    return tag(obj, o, ctx);
  } catch {
    return null;
  }
}
