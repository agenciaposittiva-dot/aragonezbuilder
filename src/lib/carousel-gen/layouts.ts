import {
  coverCrop,
  ellipseObject,
  imageObject,
  pathObject,
  rectObject,
  textObject,
  type DesignObject,
  type Paint,
  type TextObject,
} from "@/lib/design-doc";
import type { GeneratorDirection, GeneratorSlide, SlideRole } from "@/lib/design-doc/generator";
import { contrast, isDark, mix, parseHex, readable, shade } from "./color";
import { pick, rand, tintOf } from "./direction";
import { fitText, shorten } from "./fit";
import { ICONS, iconForText, isIconName, type IconName } from "./icons";

/*
 * Composição de cada slide. Cada papel (capa, problema, dado, lista…) tem
 * várias composições; a semente da direção escolhe uma por carrossel (unidade)
 * e carrosséis diferentes saem diferentes (variação). Tudo vira objetos
 * editáveis do editor: textos, formas, ícones em caminho, imagens de Arquivos.
 *
 * Regras de qualidade aplicadas aqui:
 *  - margens e área segura fixas (texto nunca encosta na borda nem no rodapé);
 *  - texto ajustado ao espaço (corpo reduz até o mínimo; depois encurta);
 *  - cor de texto escolhida para contraste WCAG sobre o que estiver atrás;
 *  - elemento de continuidade atravessa a divisa com o próximo slide, sempre
 *    no mesmo ponto da borda (as páginas do carrossel são conectadas);
 *  - numeração e barra de progresso em todos os slides (exceto a capa).
 */

export const LAYOUTS: Record<SlideRole, string[]> = {
  cover: ["cover-bleed", "cover-split", "cover-type", "cover-frame"],
  problem: ["point-left", "point-card", "point-band", "point-image"],
  context: ["point-left", "point-card", "point-band", "point-image"],
  insight: ["point-left", "point-card", "point-band", "point-image"],
  data: ["data-big", "data-chart"],
  list: ["list-checks", "list-cards", "list-grid"],
  steps: ["steps-timeline", "steps-cards"],
  comparison: ["compare-columns", "compare-stack"],
  quote: ["quote-big", "quote-card"],
  summary: ["summary-checklist", "summary-card"],
  cta: ["cta-center", "cta-accent"],
};

const NEEDS_IMAGE = new Set(["cover-bleed", "cover-split", "point-image"]);

/** Papéis que compartilham a mesma família de composição (unidade no carrossel). */
const FAMILY: Record<SlideRole, string> = {
  cover: "cover",
  problem: "point",
  context: "point",
  insight: "point",
  data: "data",
  list: "list",
  steps: "steps",
  comparison: "compare",
  quote: "quote",
  summary: "summary",
  cta: "cta",
};

export function layoutAllowed(layout: string, slide: GeneratorSlide) {
  if (NEEDS_IMAGE.has(layout)) return !!slide.visual.image;
  if (layout === "data-chart") return !!slide.chart && slide.chart.items.length >= 2;
  if (layout === "data-big") return !!slide.stat;
  if (layout === "list-grid") return slide.bullets.length >= 2 && slide.bullets.length <= 4;
  if (layout.startsWith("compare-")) return slide.columns.length === 2;
  return true;
}

/**
 * Composição do slide: a semente escolhe a variação da família; imagens têm
 * preferência quando existem. `avoid` (segunda versão) evita repetir a anterior.
 */
export function chooseLayout(slide: GeneratorSlide, seed: number, avoid?: string): string {
  const options = LAYOUTS[slide.role].filter((l) => layoutAllowed(l, slide));
  if (!options.length) {
    // Sem os dados que a composição exige (ex.: "dado" sem número): vira um ponto de texto.
    return slide.role === "cover" ? "cover-type" : "point-left";
  }
  const salt = [...FAMILY[slide.role]].reduce((n, c) => n + c.charCodeAt(0), 0);
  let list = options;
  if (avoid && options.length > 1) list = options.filter((l) => l !== avoid);
  const withImage = list.filter((l) => NEEDS_IMAGE.has(l));
  if (withImage.length && rand(seed, salt + 7) < 0.75) list = withImage;
  return pick(list, seed, salt);
}

/* ------------------------------------------------------------------ */
/* Contexto e utilidades                                               */
/* ------------------------------------------------------------------ */

export type SlideContext = {
  W: number;
  H: number;
  index: number;
  total: number;
  direction: GeneratorDirection;
  slide: GeneratorSlide;
  layout: string;
  /** Ícone do tema (quando o slide não pede um específico). */
  topicIcon: IconName;
  /** Texto do botão da chamada final. */
  ctaLabel: string;
};

type Box = { x: number; y: number; width: number; height: number };

export type RenderedSlide = { background: Paint; objects: DesignObject[] };

/** Nome usado nos textos decorativos (fora da verificação de contraste). */
export const DECORATIVE = "Decorativo";

function rgba(hex: string, a: number) {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/** Cor de texto legível sobre todos os fundos indicados. */
function readableOn(backgrounds: string[], preferred: string[], min: number) {
  const candidates = [...preferred, "#FFFFFF", "#111111"];
  for (const c of candidates) if (backgrounds.every((bg) => contrast(c, bg) >= min)) return c.toUpperCase();
  // Nenhuma passa em todos: a melhor no pior caso.
  return candidates
    .map((c) => ({ c, worst: Math.min(...backgrounds.map((bg) => contrast(c, bg))) }))
    .sort((a, b) => b.worst - a.worst)[0]!
    .c.toUpperCase();
}

class Builder {
  back: DesignObject[] = [];
  front: DesignObject[] = [];
  readonly M: number;
  readonly top: number;
  readonly bottom: number;
  readonly d: GeneratorDirection;
  readonly p: GeneratorDirection["palette"];
  /** Fundos possíveis atrás do conteúdo (página + forma de continuidade). */
  under: string[];
  headerBg: string | null = null;
  footerBg: string | null = null;
  /** Marca do cabeçalho sobre imagem: ganha uma etiqueta sólida por trás (contraste garantido). */
  headerPill = false;
  constructor(
    readonly c: SlideContext,
    readonly bg: string,
  ) {
    this.d = c.direction;
    this.p = c.direction.palette;
    this.M = Math.round(c.W * 0.085);
    this.top = Math.round(c.H * (c.H > c.W ? 0.115 : 0.12));
    this.bottom = c.H - Math.round(c.H * (c.H > c.W ? 0.135 : 0.15));
    this.under = [bg, tintOf(this.d)];
  }
  id(part: string) {
    return `${this.c.slide.key}-${part}`.slice(0, 64);
  }
  get contentWidth() {
    return this.c.W - this.M * 2;
  }
  color(kind: "ink" | "muted" | "accent", fontSize: number, weight: number, under = this.under) {
    const min = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700) ? (kind === "accent" ? 3 : 4.5) : 4.5;
    const pref =
      kind === "ink" ? [this.p.ink] : kind === "muted" ? [this.p.muted, this.p.ink] : [this.p.accent, this.p.ink];
    return readableOn(under, pref, Math.max(min, kind === "ink" ? 4.5 : min));
  }

  /** Texto ajustado à caixa. Devolve a altura estimada. */
  text(
    part: string,
    o: {
      text: string;
      x: number;
      y: number;
      width: number;
      maxHeight: number;
      size: [number, number];
      font?: "heading" | "body";
      weight?: number;
      color: string;
      align?: TextObject["textAlign"];
      lineHeight?: number;
      uppercase?: boolean;
      letterSpacing?: number;
      name: string;
      italic?: boolean;
      layer?: "back" | "front";
    },
  ) {
    const heading = (o.font ?? "body") === "heading";
    const family = heading ? this.d.fonts.heading : this.d.fonts.body;
    const weight = o.weight ?? (heading ? this.d.fonts.headingWeight : 400);
    const uppercase = o.uppercase ?? (heading && this.d.uppercase);
    const lineHeight = o.lineHeight ?? (heading ? (this.d.uppercase ? 1.02 : 1.08) : 1.38);
    let text = o.text.trim();
    const box = {
      text,
      width: o.width,
      fontFamily: family,
      fontWeight: weight,
      lineHeight,
      uppercase,
      letterSpacing: o.letterSpacing,
    };
    let fit = fitText(box, o.maxHeight, o.size[0], o.size[1]);
    for (let i = 0; fit.overflow && i < 12 && text.length > 12; i++) {
      text = shorten(text, Math.floor(text.length * 0.85));
      fit = fitText({ ...box, text }, o.maxHeight, o.size[0], o.size[1]);
    }
    const obj = textObject({
      id: this.id(part),
      name: o.name,
      x: Math.round(o.x),
      y: Math.round(o.y),
      width: Math.round(o.width),
      text: uppercase ? text.toUpperCase() : text,
      fontFamily: family,
      fontSize: fit.fontSize,
      fontWeight: weight,
      fontStyle: o.italic ? "italic" : "normal",
      textAlign: o.align ?? "left",
      lineHeight,
      letterSpacing: o.letterSpacing ?? (heading && uppercase ? 10 : 0),
      color: o.color,
    });
    obj.height = fit.height;
    (o.layer === "back" ? this.back : this.front).push(obj);
    return { height: fit.height, fontSize: fit.fontSize, obj };
  }

  rect(
    part: string,
    b: Box,
    fill: Paint | null,
    o: {
      radius?: number;
      name: string;
      stroke?: string;
      strokeWidth?: number;
      rotation?: number;
      opacity?: number;
      layer?: "back" | "front";
    },
  ) {
    const r = rectObject({
      id: this.id(part),
      name: o.name,
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height),
      rotation: o.rotation ?? 0,
      opacity: o.opacity ?? 1,
      fill,
      radius: o.radius ?? 0,
      ...(o.stroke ? { stroke: o.stroke, strokeWidth: o.strokeWidth ?? 2 } : {}),
    });
    (o.layer === "back" ? this.back : this.front).push(r);
    return r;
  }

  circle(
    part: string,
    cx: number,
    cy: number,
    size: number,
    fill: Paint | null,
    name: string,
    layer: "back" | "front" = "front",
  ) {
    const e = ellipseObject({
      id: this.id(part),
      name,
      x: Math.round(cx - size / 2),
      y: Math.round(cy - size / 2),
      width: Math.round(size),
      height: Math.round(size),
      fill,
    });
    (layer === "back" ? this.back : this.front).push(e);
    return e;
  }

  icon(
    part: string,
    name: IconName,
    x: number,
    y: number,
    size: number,
    color: string,
    o: { fill?: boolean; layer?: "back" | "front" } = {},
  ) {
    const obj = pathObject({
      id: this.id(part),
      name: "Ícone",
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(size),
      height: Math.round(size),
      d: ICONS[name],
      viewBox: [0, 0, 24, 24],
      fill: o.fill ? color : null,
      stroke: o.fill ? null : color,
      strokeWidth: o.fill ? 0 : 1.9,
      lineCap: "round",
      lineJoin: "round",
    });
    (o.layer === "back" ? this.back : this.front).push(obj);
    return obj;
  }

  image(part: string, b: Box, radius = 0, layer: "back" | "front" = "front") {
    const img = this.c.slide.visual.image;
    if (!img) return null;
    const o = imageObject({
      id: this.id(part),
      name: img.origin === "ai" ? "Imagem gerada por IA" : "Imagem",
      src: `/api/files/${img.versionId}`,
      naturalWidth: img.width,
      naturalHeight: img.height,
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height),
      radius,
    });
    o.crop = coverCrop({ width: img.width, height: img.height }, { width: b.width, height: b.height });
    (layer === "back" ? this.back : this.front).push(o);
    return o;
  }

  slideIcon(): IconName {
    const v = this.c.slide.visual.icon;
    if (v && isIconName(v)) return v;
    return iconForText(`${this.c.slide.title} ${this.c.slide.body}`) ?? this.c.topicIcon;
  }
}

/* ------------------------------------------------------------------ */
/* Elementos comuns                                                    */
/* ------------------------------------------------------------------ */

/** Forma de continuidade: atravessa a divisa com o próximo slide (x = W). */
function motif(b: Builder) {
  const { W, H, index, total } = b.c;
  if (index >= total - 1) return [];
  const tint = tintOf(b.d);
  const up = index % 2 === 0;
  const cy = Math.round(H * (up ? 0.24 : 0.76));
  const out: DesignObject[] = [];
  const name = "Elemento de continuidade";
  const id = b.id("motif");
  switch (b.d.motif) {
    case "orbit": {
      const size = Math.round(W * 0.6);
      out.push(ellipseObject({ id, name, x: W - size / 2, y: cy - size / 2, width: size, height: size, fill: tint }));
      const ring = Math.round(size * 0.42);
      out.push(
        ellipseObject({
          id: `${id}2`,
          name,
          x: W - ring / 2,
          y: cy - ring / 2,
          width: ring,
          height: ring,
          fill: null,
          stroke: mix(tint, b.p.accent, 0.35),
          strokeWidth: 6,
        }),
      );
      break;
    }
    case "ribbon": {
      const w = Math.round(W * 0.7);
      const h = Math.round(H * 0.085);
      out.push(
        rectObject({
          id,
          name,
          x: W - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          rotation: up ? -12 : 12,
          fill: tint,
          radius: h / 2,
        }),
      );
      break;
    }
    case "wave": {
      const w = Math.round(W * 0.9);
      const h = Math.round(H * 0.17);
      out.push(
        pathObject({
          id,
          name,
          x: W - w / 2,
          y: H - h - Math.round(H * 0.03),
          width: w,
          height: h,
          viewBox: [0, 0, 100, 40],
          d: up
            ? "M 0 24 C 18 6 32 6 50 20 C 68 34 82 34 100 16 L 100 40 L 0 40 Z"
            : "M 0 16 C 18 34 32 34 50 20 C 68 6 82 6 100 24 L 100 40 L 0 40 Z",
          fill: tint,
          stroke: null,
        }),
      );
      break;
    }
    case "blocks": {
      const s = Math.round(W * 0.34);
      out.push(
        rectObject({
          id,
          name,
          x: W - s / 2,
          y: cy - s / 2,
          width: s,
          height: s,
          rotation: up ? 14 : -14,
          fill: tint,
          radius: Math.min(48, b.d.radius + 12),
        }),
      );
      const s2 = Math.round(s * 0.36);
      out.push(
        rectObject({
          id: `${id}2`,
          name,
          x: W - s2 / 2 + s * 0.38,
          y: cy - s2 / 2 + (up ? s * 0.42 : -s * 0.42),
          width: s2,
          height: s2,
          rotation: up ? -8 : 8,
          fill: mix(b.bg, b.p.accent2, 0.35),
          radius: Math.min(24, b.d.radius),
        }),
      );
      break;
    }
    case "dots": {
      // Pontos fortes ficam dentro das margens (não passam por trás do texto).
      const dot = 12;
      const gap = 32;
      const cols = 5;
      const rows = 6;
      const x0 = W - ((cols - 1) * gap) / 2;
      const y0 = cy - ((rows - 1) * gap) / 2;
      const children: DesignObject[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          children.push(
            ellipseObject({
              id: `${id}d${r}${c}`,
              name: "Ponto",
              x: x0 + c * gap - dot / 2,
              y: y0 + r * gap - dot / 2,
              width: dot,
              height: dot,
              fill: mix(b.bg, b.p.accent, 0.55),
            }),
          );
      out.push({
        id,
        name,
        type: "group",
        x: x0 - dot / 2,
        y: y0 - dot / 2,
        width: (cols - 1) * gap + dot,
        height: (rows - 1) * gap + dot,
        rotation: 0,
        opacity: 1,
        children,
      });
      break;
    }
  }
  return out.map((o) => ({ ...o, x: Math.round(o.x), y: Math.round(o.y) }));
}

/** Cabeçalho (marca do cliente) e rodapé (contador, progresso e "arraste"). */
function chrome(b: Builder, opts: { header?: boolean; footer?: boolean } = {}) {
  const { W, H, index, total } = b.c;
  const M = b.M;
  const headerBg = [b.headerBg ?? b.bg, ...(b.headerBg ? [] : [tintOf(b.d)])];
  const footerBg = [b.footerBg ?? b.bg, ...(b.footerBg ? [] : [tintOf(b.d)])];
  const y = Math.round(H * 0.045);
  if (opts.header !== false) {
    const logo = b.d.logo;
    const pillBg = b.headerPill ? b.bg : null;
    if (pillBg && (logo || b.d.handle)) {
      const w = logo
        ? Math.round(Math.min(220 / logo.width, 56 / logo.height) * logo.width) + 40
        : Math.min(W * 0.55, b.d.handle.length * 16 + 48);
      b.rect("handle-bg", { x: M - 20, y: y - 12, width: w, height: 80 }, pillBg, {
        radius: 40,
        name: "Etiqueta da marca",
      });
    }
    if (logo) {
      const maxW = 220;
      const maxH = 56;
      const s = Math.min(maxW / logo.width, maxH / logo.height);
      b.front.push(
        imageObject({
          id: b.id("logo"),
          name: "Logo do cliente",
          src: `/api/files/${logo.versionId}`,
          naturalWidth: logo.width,
          naturalHeight: logo.height,
          x: M,
          y,
          width: Math.round(logo.width * s),
          height: Math.round(logo.height * s),
        }),
      );
    } else if (b.d.handle) {
      b.text("handle", {
        text: b.d.handle,
        x: M,
        y: y + 8,
        width: W * 0.55,
        maxHeight: 40,
        size: [26, 22],
        weight: 700,
        color: readableOn(pillBg ? [pillBg] : headerBg, [b.p.ink], 4.5),
        name: "Marca",
      });
    }
  }
  if (opts.footer === false) return;
  const fy = H - Math.round(H * 0.075);
  const muted = readableOn(footerBg, [b.p.muted, b.p.ink], 4.5);
  if (index > 0) {
    b.text("counter", {
      text: `${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`,
      x: M,
      y: fy - 15,
      width: 120,
      maxHeight: 40,
      size: [26, 22],
      weight: 700,
      color: muted,
      name: "Contador",
    });
    const tw = Math.round(W * 0.2);
    const track = { x: M + 118, y: fy - 3, width: tw, height: 6 };
    b.rect("track", track, mix(footerBg[0]!, muted, 0.3), { radius: 3, name: "Progresso (trilho)" });
    b.rect(
      "progress",
      { ...track, width: Math.max(10, Math.round((tw * (index + 1)) / total)) },
      readableOn(footerBg, [b.p.accent, b.p.ink], 3),
      {
        radius: 3,
        name: "Progresso",
      },
    );
  }
  if (index < total - 1) {
    const size = 64;
    const fill = readableOn(footerBg, [b.p.accent, b.p.ink], 3);
    const cx = W - M - size / 2;
    b.circle("next", cx, fy, size, fill, "Próximo slide");
    b.icon("next-icon", "arrow", cx - 18, fy - 18, 36, readable(fill, [b.p.onAccent, b.bg], 3));
    if (index === 0) {
      b.text("swipe", {
        text: "Arraste para o lado",
        x: W - M - size - 24 - 340,
        y: fy - 16,
        width: 340,
        maxHeight: 40,
        size: [26, 22],
        weight: 700,
        align: "right",
        color: muted,
        name: "Arraste",
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Composições                                                         */
/* ------------------------------------------------------------------ */

function kickerText(b: Builder) {
  return b.c.slide.kicker.trim();
}

function pill(b: Builder, part: string, text: string, x: number, y: number, fill: string, color: string) {
  const size = 24;
  const width = Math.min(b.contentWidth, Math.round(text.length * size * 0.72 + 56));
  b.rect(`${part}-bg`, { x, y, width, height: 52 }, fill, { radius: 26, name: "Etiqueta" });
  b.text(part, {
    text,
    x: x + 28,
    y: y + 12,
    width: width - 40,
    maxHeight: 32,
    size: [size, 18],
    weight: 700,
    uppercase: true,
    letterSpacing: 90,
    color,
    name: "Chamada",
  });
  return 52;
}

function cover(b: Builder, layout: string): RenderedSlide {
  const { W, H } = b.c;
  const s = b.c.slide;
  const M = b.M;
  const p = b.p;
  let background: Paint = b.bg;
  const big: [number, number] = H > W ? [128, 62] : [110, 56];

  if (layout === "cover-bleed" && s.visual.image) {
    b.image("img", { x: 0, y: 0, width: W, height: H }, 0, "back");
    // Degradê da cor de fundo por baixo do texto (contraste garantido na metade de baixo).
    b.back.push(
      rectObject({
        id: b.id("shade"),
        name: "Degradê para leitura",
        x: 0,
        y: Math.round(H * 0.3),
        width: W,
        height: H - Math.round(H * 0.3),
        fill: {
          type: "linear",
          angle: 90,
          stops: [
            { offset: 0, color: rgba(b.bg, 0) },
            { offset: 0.42, color: rgba(b.bg, 0.94) },
            { offset: 1, color: rgba(b.bg, 1) },
          ],
        },
      }),
    );
    b.under = [b.bg];
    b.headerPill = true;
    let y = Math.round(H * 0.52);
    if (kickerText(b)) y += pill(b, "kicker", kickerText(b), M, y, p.accent, p.onAccent) + 28;
    const t = b.text("title", {
      text: s.title,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: b.bottom - y - 150,
      size: big,
      font: "heading",
      color: b.color("ink", 64, 800),
      name: "Título",
    });
    y += t.height + 24;
    if (s.body)
      b.text("body", {
        text: s.body,
        x: M,
        y,
        width: b.contentWidth * 0.92,
        maxHeight: Math.max(60, b.bottom - y),
        size: [36, 26],
        color: b.color("muted", 30, 400),
        name: "Subtítulo",
      });
    return { background, objects: [] };
  }
  if (layout === "cover-split" && s.visual.image) {
    const ih = Math.round(H * 0.56);
    b.image("img", { x: 0, y: 0, width: W, height: ih }, 0, "back");
    b.headerPill = true;
    let y = ih + 56;
    if (kickerText(b)) pill(b, "kicker", kickerText(b), M, ih - 26, p.accent, p.onAccent);
    const t = b.text("title", {
      text: s.title,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: b.bottom - y - 70,
      size: [H > W ? 96 : 80, 52],
      font: "heading",
      color: b.color("ink", 60, 800),
      name: "Título",
    });
    y += t.height + 20;
    if (s.body)
      b.text("body", {
        text: s.body,
        x: M,
        y,
        width: b.contentWidth,
        maxHeight: Math.max(50, b.bottom - y),
        size: [32, 24],
        color: b.color("muted", 28, 400),
        name: "Subtítulo",
      });
    return { background, objects: [] };
  }
  if (layout === "cover-frame") {
    // Fundo na cor de destaque, com moldura: o texto usa a cor legível sobre ela.
    const bg = contrast(p.accent, p.onAccent) >= 4.5 ? p.accent : p.ink;
    background = bg;
    const on = readable(bg, [p.onAccent, p.bg, "#FFFFFF", "#111111"], 4.5);
    b.under = [bg];
    b.headerBg = bg;
    b.footerBg = bg;
    // Fundo como forma (cobre a continuidade que vem do slide vizinho).
    b.rect("bg", { x: 0, y: 0, width: W, height: H }, bg, { name: "Fundo", layer: "back" });
    const inset = Math.round(M * 0.55);
    b.rect("frame", { x: inset, y: inset, width: W - inset * 2, height: H - inset * 2 }, null, {
      name: "Moldura",
      stroke: on,
      strokeWidth: 4,
      radius: b.d.radius,
      layer: "back",
    });
    let y = Math.round(H * 0.22);
    if (kickerText(b)) {
      b.text("kicker", {
        text: kickerText(b),
        x: M,
        y,
        width: b.contentWidth,
        maxHeight: 40,
        size: [26, 20],
        weight: 700,
        uppercase: true,
        letterSpacing: 140,
        color: on,
        name: "Chamada",
      });
      y += 64;
    }
    const t = b.text("title", {
      text: s.title,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: (b.bottom - y) * 0.72,
      size: big,
      font: "heading",
      color: on,
      name: "Título",
    });
    y += t.height + 36;
    b.rect("bar", { x: M, y, width: 120, height: 10 }, on, { radius: 5, name: "Detalhe" });
    y += 46;
    if (s.body)
      b.text("body", {
        text: s.body,
        x: M,
        y,
        width: b.contentWidth * 0.9,
        maxHeight: Math.max(60, b.bottom - y),
        size: [36, 26],
        color: on,
        name: "Subtítulo",
      });
    return { background, objects: [] };
  }
  // cover-type: tipográfica com ícone grande do tema.
  const icon = b.slideIcon();
  const size = Math.round(W * 0.3);
  const ix = W - M - size;
  const iy = b.bottom - size - 30;
  b.circle("icon-bg", ix + size / 2, iy + size / 2, size * 1.25, mix(b.bg, p.accent, 0.22), "Fundo do ícone", "back");
  b.icon(
    "icon",
    icon,
    ix + size * 0.12,
    iy + size * 0.12,
    size * 0.76,
    readable(mix(b.bg, p.accent, 0.22), [p.accent, p.ink], 3),
  );
  let y = Math.round(H * 0.17);
  if (kickerText(b)) y += pill(b, "kicker", kickerText(b), M, y, p.accent, p.onAccent) + 40;
  const t = b.text("title", {
    text: s.title,
    x: M,
    y,
    width: b.contentWidth,
    maxHeight: (iy - y) * 0.8,
    size: big,
    font: "heading",
    color: b.color("ink", 64, 800),
    name: "Título",
  });
  y += t.height + 32;
  if (s.body)
    b.text("body", {
      text: s.body,
      x: M,
      y,
      width: b.contentWidth * 0.62,
      maxHeight: Math.max(60, b.bottom - y - 20),
      size: [36, 26],
      color: b.color("muted", 30, 400),
      name: "Subtítulo",
    });
  return { background, objects: [] };
}

function point(b: Builder, layout: string): RenderedSlide {
  const { W, H, index } = b.c;
  const s = b.c.slide;
  const M = b.M;
  const p = b.p;
  const background: Paint = b.bg;
  const titleSize: [number, number] = H > W ? [80, 48] : [70, 44];

  if (layout === "point-band") {
    const bandH = Math.round(H * 0.34);
    b.rect("band", { x: 0, y: 0, width: W, height: bandH }, p.accent, { name: "Faixa", layer: "back" });
    b.headerBg = p.accent;
    const on = readable(p.accent, [p.onAccent, "#FFFFFF", "#111111"], 4.5);
    b.icon("icon", b.slideIcon(), M, bandH - 150, 110, on);
    if (kickerText(b))
      b.text("kicker", {
        text: kickerText(b),
        x: M + 140,
        y: bandH - 110,
        width: b.contentWidth - 140,
        maxHeight: 40,
        size: [26, 20],
        weight: 700,
        uppercase: true,
        letterSpacing: 120,
        color: on,
        name: "Chamada",
      });
    let y = bandH + 64;
    const t = b.text("title", {
      text: s.title,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: (b.bottom - y) * 0.48,
      size: titleSize,
      font: "heading",
      color: b.color("ink", 60, 800),
      name: "Título",
    });
    y += t.height + 30;
    if (s.body)
      b.text("body", {
        text: s.body,
        x: M,
        y,
        width: b.contentWidth,
        maxHeight: b.bottom - y,
        size: [38, 26],
        color: b.color("ink", 30, 400),
        name: "Texto",
      });
    return { background, objects: [] };
  }
  if (layout === "point-card") {
    const card = { x: M, y: b.top + 10, width: b.contentWidth, height: b.bottom - b.top - 10 };
    const surface = isDark(b.bg) ? shade(b.bg, 0.08) : p.surface;
    b.rect("card", card, surface, { name: "Cartão", radius: b.d.radius, layer: "back" });
    b.rect("card-strip", { x: card.x, y: card.y, width: card.width, height: 14 }, p.accent, {
      name: "Detalhe",
      radius: Math.min(7, b.d.radius),
    });
    const pad = 64;
    const under = [surface];
    let y = card.y + pad + 10;
    if (kickerText(b)) {
      b.text("kicker", {
        text: kickerText(b),
        x: card.x + pad,
        y,
        width: card.width - pad * 2,
        maxHeight: 40,
        size: [26, 20],
        weight: 700,
        uppercase: true,
        letterSpacing: 120,
        color: b.color("accent", 26, 700, under),
        name: "Chamada",
      });
      y += 62;
    }
    const iconSize = 120;
    const first = b.front.length;
    const t = b.text("title", {
      text: s.title,
      x: card.x + pad,
      y,
      width: card.width - pad * 2,
      maxHeight: (card.y + card.height - y - iconSize) * 0.55,
      size: titleSize,
      font: "heading",
      color: b.color("ink", 60, 800, under),
      name: "Título",
    });
    y += t.height + 30;
    if (s.body)
      y += b.text("body", {
        text: s.body,
        x: card.x + pad,
        y,
        width: card.width - pad * 2,
        maxHeight: card.y + card.height - y - iconSize - 40,
        size: [36, 26],
        color: b.color("ink", 30, 400, under),
        name: "Texto",
      }).height;
    // Texto curto: desce o bloco para o meio do cartão (sem encostar no ícone).
    const spare = card.y + card.height - pad - iconSize - 40 - y;
    if (spare > 120) for (const o of b.front.slice(first)) o.y = Math.round(o.y + spare * 0.4);
    b.icon(
      "icon",
      b.slideIcon(),
      card.x + card.width - pad - iconSize,
      card.y + card.height - pad - iconSize,
      iconSize,
      readable(surface, [p.accent, p.ink], 3),
    );
    return { background, objects: [] };
  }
  if (layout === "point-image" && s.visual.image) {
    const ih = Math.round((b.bottom - b.top) * 0.47);
    b.image("img", { x: M, y: b.top, width: b.contentWidth, height: ih }, b.d.radius);
    let y = b.top + ih + 48;
    if (kickerText(b)) {
      b.text("kicker", {
        text: kickerText(b),
        x: M,
        y,
        width: b.contentWidth,
        maxHeight: 40,
        size: [24, 20],
        weight: 700,
        uppercase: true,
        letterSpacing: 120,
        color: b.color("accent", 24, 700),
        name: "Chamada",
      });
      y += 52;
    }
    const t = b.text("title", {
      text: s.title,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: (b.bottom - y) * 0.55,
      size: [H > W ? 64 : 56, 40],
      font: "heading",
      color: b.color("ink", 50, 800),
      name: "Título",
    });
    y += t.height + 22;
    if (s.body)
      b.text("body", {
        text: s.body,
        x: M,
        y,
        width: b.contentWidth,
        maxHeight: b.bottom - y,
        size: [32, 24],
        color: b.color("ink", 28, 400),
        name: "Texto",
      });
    return { background, objects: [] };
  }
  // point-left: número grande decorativo, ícone, título e texto.
  b.text("number", {
    text: String(index).padStart(2, "0"),
    x: W - M - 360,
    y: b.top - 30,
    width: 360,
    maxHeight: 300,
    size: [260, 160],
    font: "heading",
    align: "right",
    color: mix(b.bg, p.accent, 0.2),
    name: `${DECORATIVE}: número do slide`,
    layer: "back",
    uppercase: false,
  });
  let y = b.top + 20;
  b.icon("icon", b.slideIcon(), M, y, 96, b.color("accent", 40, 700));
  y += 96 + 44;
  if (kickerText(b)) {
    b.text("kicker", {
      text: kickerText(b),
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: 40,
      size: [26, 20],
      weight: 700,
      uppercase: true,
      letterSpacing: 120,
      color: b.color("accent", 26, 700),
      name: "Chamada",
    });
    y += 56;
  }
  const t = b.text("title", {
    text: s.title,
    x: M,
    y,
    width: b.contentWidth,
    maxHeight: (b.bottom - y) * 0.5,
    size: titleSize,
    font: "heading",
    color: b.color("ink", 60, 800),
    name: "Título",
  });
  y += t.height + 34;
  b.rect("bar", { x: M, y, width: 96, height: 10 }, b.color("accent", 40, 700), { radius: 5, name: "Detalhe" });
  y += 44;
  if (s.body)
    b.text("body", {
      text: s.body,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: b.bottom - y,
      size: [38, 26],
      color: b.color("ink", 30, 400),
      name: "Texto",
    });
  return { background, objects: [] };
}

function data(b: Builder, layout: string): RenderedSlide {
  const { W, H } = b.c;
  const s = b.c.slide;
  const M = b.M;
  let y = b.top + 10;
  if (kickerText(b)) {
    b.text("kicker", {
      text: kickerText(b),
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: 40,
      size: [26, 20],
      weight: 700,
      uppercase: true,
      letterSpacing: 120,
      color: b.color("accent", 26, 700),
      name: "Chamada",
    });
    y += 56;
  }
  const t = b.text("title", {
    text: s.title,
    x: M,
    y,
    width: b.contentWidth,
    maxHeight: (b.bottom - y) * 0.26,
    size: [62, 40],
    font: "heading",
    color: b.color("ink", 50, 800),
    name: "Título",
  });
  y += t.height + 40;
  const sourceText = (layout === "data-chart" ? s.chart?.source : s.stat?.source)?.trim();
  const sourceLine = sourceText ? `Fonte: ${sourceText}` : "Fonte: confirmar antes de publicar";
  const sourceH = 70;
  if (layout === "data-chart" && s.chart) {
    const items = s.chart.items;
    const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
    const areaTop = y + 50;
    const areaBottom = b.bottom - sourceH - 70;
    const gap = 28;
    const bw = (b.contentWidth - gap * (items.length - 1)) / items.length;
    const best = items.reduce((m, it, i) => (Math.abs(it.value) > Math.abs(items[m]!.value) ? i : m), 0);
    items.forEach((it, i) => {
      const h = Math.max(8, ((areaBottom - areaTop) * Math.abs(it.value)) / max);
      const x = M + i * (bw + gap);
      const fill = i === best ? b.color("accent", 40, 700) : mix(b.bg, b.color("accent", 40, 700), 0.45);
      b.rect(`bar${i}`, { x, y: areaBottom - h, width: bw, height: h }, fill, {
        radius: Math.min(16, b.d.radius / 2),
        name: "Barra do gráfico",
      });
      b.text(`bar${i}-v`, {
        text: `${formatNumber(it.value)}${s.chart!.unit}`,
        x,
        y: areaBottom - h - 48,
        width: bw,
        maxHeight: 44,
        size: [32, 20],
        weight: 700,
        align: "center",
        color: b.color("ink", 28, 700),
        name: "Valor",
      });
      b.text(`bar${i}-l`, {
        text: it.label,
        x,
        y: areaBottom + 14,
        width: bw,
        maxHeight: 60,
        size: [24, 18],
        align: "center",
        color: b.color("muted", 22, 400),
        name: "Rótulo",
      });
    });
  } else if (s.stat) {
    const st = b.text("stat", {
      text: s.stat.value,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: (b.bottom - y - sourceH) * 0.55,
      size: [H > W ? 250 : 200, 110],
      font: "heading",
      weight: Math.max(700, b.d.fonts.headingWeight),
      color: b.color("accent", 120, 800),
      name: "Número",
      uppercase: false,
    });
    y += st.height + 20;
    b.text("statlabel", {
      text: s.stat.label,
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: b.bottom - y - sourceH - 10,
      size: [40, 28],
      color: b.color("ink", 32, 400),
      name: "Texto do número",
    });
  }
  b.text("source", {
    text: sourceLine,
    x: M,
    y: b.bottom - sourceH + 10,
    width: b.contentWidth,
    maxHeight: sourceH,
    size: [24, 20],
    color: b.color("muted", 22, 400),
    name: "Fonte",
    italic: !sourceText,
  });
  return { background: b.bg, objects: [] };
}

function formatNumber(n: number) {
  return Number.isInteger(n) ? n.toLocaleString("pt-BR") : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function list(b: Builder, layout: string): RenderedSlide {
  const s = b.c.slide;
  const M = b.M;
  const p = b.p;
  const steps = s.role === "steps";
  let y = b.top + 10;
  if (kickerText(b)) {
    b.text("kicker", {
      text: kickerText(b),
      x: M,
      y,
      width: b.contentWidth,
      maxHeight: 40,
      size: [26, 20],
      weight: 700,
      uppercase: true,
      letterSpacing: 120,
      color: b.color("accent", 26, 700),
      name: "Chamada",
    });
    y += 56;
  }
  const t = b.text("title", {
    text: s.title,
    x: M,
    y,
    width: b.contentWidth,
    maxHeight: (b.bottom - y) * 0.3,
    size: [66, 42],
    font: "heading",
    color: b.color("ink", 50, 800),
    name: "Título",
  });
  y += t.height + 46;
  const items = s.bullets.length ? s.bullets : s.body ? [s.body] : [];
  const n = Math.max(1, items.length);
  const avail = b.bottom - y;
  const surface = isDark(b.bg) ? shade(b.bg, 0.08) : p.surface;

  if (layout === "list-grid") {
    const cols = 2;
    const rows = Math.ceil(n / cols);
    const gap = 28;
    const cw = (b.contentWidth - gap) / cols;
    const ch = (avail - gap * (rows - 1)) / rows;
    items.forEach((it, i) => {
      const x = M + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + gap);
      b.rect(`b${i}-card`, { x, y: cy, width: cw, height: ch }, surface, { radius: b.d.radius, name: "Cartão" });
      b.icon(
        `b${i}-icon`,
        steps ? "check" : (iconForText(it) ?? b.slideIcon()),
        x + 36,
        cy + 36,
        64,
        readable(surface, [p.accent, p.ink], 3),
      );
      b.text(`b${i}`, {
        text: it,
        x: x + 36,
        y: cy + 128,
        width: cw - 72,
        maxHeight: ch - 160,
        size: [32, 22],
        weight: 600,
        color: b.color("ink", 26, 600, [surface]),
        name: "Item",
      });
    });
    return { background: b.bg, objects: [] };
  }
  const gap = layout === "list-cards" || layout === "steps-cards" || layout === "summary-card" ? 22 : 30;
  const rowH = (avail - gap * (n - 1)) / n;
  // Corpo comum para todos os itens (unidade): o do item mais longo.
  const longest = items.reduce((a, c) => (c.length > a.length ? c : a), "");
  const textX = M + (layout === "steps-timeline" ? 110 : 96);
  const textW = b.contentWidth - (textX - M) - (layout === "list-cards" || layout === "steps-cards" ? 40 : 0);
  const probe = fitText(
    { text: longest, width: textW, fontFamily: b.d.fonts.body, fontWeight: 600, lineHeight: 1.32 },
    Math.min(rowH - (layout.endsWith("cards") ? 36 : 6), 260),
    38,
    22,
  );
  const size: [number, number] = [probe.fontSize, Math.min(probe.fontSize, 22)];
  if (layout === "steps-timeline" && n > 1) {
    b.rect(
      "line",
      { x: M + 30, y: y + 30, width: 6, height: rowH * (n - 1) + gap * (n - 1) },
      mix(b.bg, p.accent, 0.4),
      { radius: 3, name: "Linha do tempo", layer: "back" },
    );
  }
  items.forEach((it, i) => {
    const ry = y + i * (rowH + gap);
    const marker = b.color("accent", 40, 700);
    if (layout === "list-cards" || layout === "steps-cards" || layout === "summary-card") {
      b.rect(`b${i}-card`, { x: M, y: ry, width: b.contentWidth, height: rowH }, surface, {
        radius: Math.min(b.d.radius, rowH / 2),
        name: "Cartão",
      });
      b.text(`b${i}-n`, {
        text: String(i + 1).padStart(2, "0"),
        x: M + 28,
        y: ry + rowH / 2 - 24,
        width: 64,
        maxHeight: 50,
        size: [36, 28],
        font: "heading",
        weight: 800,
        color: readable(surface, [p.accent, p.ink], 3),
        name: "Número do item",
        uppercase: false,
      });
      b.text(`b${i}`, {
        text: it,
        x: textX,
        y: ry + 18,
        width: textW,
        maxHeight: rowH - 36,
        size,
        weight: 600,
        color: b.color("ink", 26, 600, [surface]),
        name: "Item",
        lineHeight: 1.32,
      });
    } else if (layout === "steps-timeline") {
      b.circle(`b${i}-dot`, M + 33, ry + 30, 66, marker, "Marcador");
      b.text(`b${i}-n`, {
        text: String(i + 1),
        x: M,
        y: ry + 10,
        width: 66,
        maxHeight: 44,
        size: [32, 24],
        weight: 800,
        align: "center",
        color: readable(marker, [p.onAccent, b.bg], 4.5),
        name: "Número do passo",
      });
      b.text(`b${i}`, {
        text: it,
        x: textX,
        y: ry + 6,
        width: textW,
        maxHeight: rowH - 6,
        size,
        weight: 600,
        color: b.color("ink", 26, 600),
        name: "Item",
        lineHeight: 1.32,
      });
    } else {
      b.circle(`b${i}-dot`, M + 28, ry + 26, 56, marker, "Marcador");
      b.icon(`b${i}-icon`, "check", M + 12, ry + 10, 32, readable(marker, [p.onAccent, b.bg], 3));
      b.text(`b${i}`, {
        text: it,
        x: textX,
        y: ry + 4,
        width: textW,
        maxHeight: rowH - 4,
        size,
        weight: 600,
        color: b.color("ink", 26, 600),
        name: "Item",
        lineHeight: 1.32,
      });
    }
  });
  return { background: b.bg, objects: [] };
}

function compare(b: Builder, layout: string): RenderedSlide {
  const s = b.c.slide;
  const M = b.M;
  const p = b.p;
  let y = b.top + 10;
  const t = b.text("title", {
    text: s.title,
    x: M,
    y,
    width: b.contentWidth,
    maxHeight: (b.bottom - y) * 0.24,
    size: [62, 40],
    font: "heading",
    color: b.color("ink", 50, 800),
    name: "Título",
  });
  y += t.height + 40;
  const surface = isDark(b.bg) ? shade(b.bg, 0.08) : p.surface;
  const [left, right] = s.columns;
  const strong = readable(surface, [p.accent, p.ink], 3);
  const weak = mix(surface, b.color("muted", 30, 400, [surface]), 0.85);
  const cols = [
    { c: left!, icon: "x" as IconName, color: readable(surface, [weak, p.muted, p.ink], 3) },
    { c: right!, icon: "check" as IconName, color: strong },
  ];
  const draw = (i: number, box: Box) => {
    const col = cols[i]!;
    b.rect(`c${i}-card`, box, surface, {
      radius: b.d.radius,
      name: "Cartão",
      ...(i === 1 ? { stroke: strong, strokeWidth: 4 } : {}),
    });
    b.icon(`c${i}-icon`, col.icon, box.x + 32, box.y + 30, 48, col.color);
    b.text(`c${i}-label`, {
      text: col.c.label,
      x: box.x + 96,
      y: box.y + 34,
      width: box.width - 128,
      maxHeight: 48,
      size: [32, 22],
      weight: 800,
      uppercase: true,
      letterSpacing: 60,
      color: readable(surface, [col.color, p.ink], 4.5),
      name: "Rótulo",
    });
    const items = col.c.items.length ? col.c.items : [""];
    const ih = (box.height - 130) / items.length;
    // Mesmo corpo para os itens das duas colunas (o do item mais longo).
    const longest = [...cols[0]!.c.items, ...cols[1]!.c.items].reduce((a, c) => (c.length > a.length ? c : a), "");
    const size = fitText(
      { text: longest, width: box.width - 64, fontFamily: b.d.fonts.body, fontWeight: 400, lineHeight: 1.3 },
      Math.min(ih - 28, 220),
      32,
      20,
    ).fontSize;
    items.forEach((it, j) => {
      const top = box.y + 112 + j * ih;
      if (j > 0)
        b.rect(
          `c${i}-sep${j}`,
          { x: box.x + 32, y: top - 1, width: box.width - 64, height: 2 },
          mix(surface, p.muted, 0.25),
          { name: "Divisória" },
        );
      b.text(`c${i}-i${j}`, {
        text: it,
        x: box.x + 32,
        y: top + 18,
        width: box.width - 64,
        maxHeight: ih - 30,
        size: [size, Math.min(size, 20)],
        color: b.color("ink", 26, 400, [surface]),
        name: "Item",
        lineHeight: 1.3,
      });
    });
  };
  const avail = b.bottom - y;
  if (layout === "compare-stack") {
    const gap = 70;
    const h = (avail - gap) / 2;
    draw(0, { x: M, y, width: b.contentWidth, height: h });
    draw(1, { x: M, y: y + h + gap, width: b.contentWidth, height: h });
    const vs = 96;
    const fill = b.color("accent", 40, 700);
    b.circle("vs-bg", b.c.W / 2, y + h + gap / 2, vs, fill, "Selo");
    b.text("vs", {
      text: "VS",
      x: b.c.W / 2 - vs / 2,
      y: y + h + gap / 2 - 20,
      width: vs,
      maxHeight: 44,
      size: [34, 26],
      weight: 800,
      align: "center",
      color: readable(fill, [p.onAccent, b.bg], 4.5),
      name: "Selo",
      uppercase: false,
    });
  } else {
    const gap = 28;
    const w = (b.contentWidth - gap) / 2;
    draw(0, { x: M, y, width: w, height: avail });
    draw(1, { x: M + w + gap, y, width: w, height: avail });
  }
  return { background: b.bg, objects: [] };
}

function quote(b: Builder, layout: string): RenderedSlide {
  const s = b.c.slide;
  const M = b.M;
  const p = b.p;
  const card = layout === "quote-card";
  const surface = isDark(b.bg) ? shade(b.bg, 0.08) : p.surface;
  const under = card ? [surface] : b.under;
  const box = card
    ? { x: M, y: b.top + 20, width: b.contentWidth, height: b.bottom - b.top - 20 }
    : { x: 0, y: b.top, width: b.c.W, height: b.bottom - b.top };
  if (card) b.rect("card", box, surface, { radius: b.d.radius, name: "Cartão", layer: "back" });
  const pad = card ? 64 : M;
  let y = box.y + (card ? 64 : 30);
  b.icon("quote", "quote", box.x + pad, y, 120, b.color("accent", 40, 700, under), { fill: true });
  y += 170;
  const t = b.text("title", {
    text: s.title,
    x: box.x + pad,
    y,
    width: box.width - pad * 2,
    maxHeight: (box.y + box.height - y) * 0.7,
    size: [64, 38],
    font: "heading",
    italic: b.d.fonts.heading.includes("Serif"),
    color: b.color("ink", 50, 700, under),
    name: "Citação",
  });
  y += t.height + 40;
  if (s.body) {
    b.rect("rule", { x: box.x + pad, y: y + 18, width: 56, height: 6 }, b.color("accent", 40, 700, under), {
      radius: 3,
      name: "Detalhe",
    });
    b.text("body", {
      text: s.body,
      x: box.x + pad + 76,
      y,
      width: box.width - pad * 2 - 76,
      maxHeight: box.y + box.height - y - 20,
      size: [30, 22],
      weight: 600,
      color: b.color("muted", 26, 600, under),
      name: "Autor",
    });
  }
  return { background: b.bg, objects: [] };
}

function cta(b: Builder, layout: string): RenderedSlide {
  const { W, H } = b.c;
  const s = b.c.slide;
  const M = b.M;
  const p = b.p;
  let bg = b.bg;
  if (
    layout === "cta-accent" &&
    contrast(p.accent, readable(p.accent, [p.onAccent, "#FFFFFF", "#111111"], 4.5)) >= 4.5
  ) {
    bg = p.accent;
    b.under = [bg];
    b.headerBg = bg;
    b.footerBg = bg;
    b.rect("bg", { x: 0, y: 0, width: W, height: H }, bg, { name: "Fundo", layer: "back" });
  }
  const on = bg === b.bg ? null : readable(bg, [p.onAccent, "#FFFFFF", "#111111"], 4.5);
  const ink = on ?? b.color("ink", 60, 800);
  let y = b.top + Math.round(H * 0.06);
  const logo = b.d.logo;
  if (logo) {
    const s2 = Math.min(300 / logo.width, 110 / logo.height);
    const lw = Math.round(logo.width * s2);
    b.front.push(
      imageObject({
        id: b.id("cta-logo"),
        name: "Logo do cliente",
        src: `/api/files/${logo.versionId}`,
        naturalWidth: logo.width,
        naturalHeight: logo.height,
        x: Math.round((W - lw) / 2),
        y,
        width: lw,
        height: Math.round(logo.height * s2),
      }),
    );
    y += Math.round(logo.height * s2) + 50;
  } else {
    const iconSize = 110;
    b.icon("icon", "bookmark", W / 2 - iconSize / 2, y, iconSize, on ?? b.color("accent", 40, 700));
    y += iconSize + 50;
  }
  const t = b.text("title", {
    text: s.title,
    x: M,
    y,
    width: b.contentWidth,
    maxHeight: (b.bottom - y) * 0.42,
    size: [H > W ? 88 : 76, 46],
    font: "heading",
    align: "center",
    color: ink,
    name: "Título",
  });
  y += t.height + 28;
  if (s.body) {
    const body = b.text("body", {
      text: s.body,
      x: M + 20,
      y,
      width: b.contentWidth - 40,
      maxHeight: (b.bottom - y) * 0.45,
      size: [34, 24],
      align: "center",
      color: on ?? b.color("muted", 28, 400),
      name: "Texto",
    });
    y += body.height + 44;
  }
  // Botão (forma + texto): editável como qualquer outro elemento.
  const label = b.c.ctaLabel;
  const bw = Math.min(b.contentWidth, Math.round(label.length * 34 * 0.62 + 120));
  const btnFill = on ? readable(bg, [p.ink, b.bg, "#111111", "#FFFFFF"], 3) : b.color("accent", 40, 700);
  const btnText = readable(btnFill, [on ? bg : p.onAccent, "#FFFFFF", "#111111"], 4.5);
  b.rect("button-bg", { x: (W - bw) / 2, y, width: bw, height: 92 }, btnFill, { radius: 46, name: "Botão" });
  b.text("button", {
    text: label,
    x: (W - bw) / 2 + 30,
    y: y + 26,
    width: bw - 60,
    maxHeight: 44,
    size: [34, 24],
    weight: 800,
    align: "center",
    color: btnText,
    name: "Texto do botão",
    uppercase: false,
  });
  y += 92 + 56;
  const actions: [IconName, string][] = [
    ["bookmark", "Salve"],
    ["send", "Compartilhe"],
    ["comment", "Comente"],
  ];
  const slot = Math.min(240, b.contentWidth / 3);
  if (y + 110 < b.bottom) {
    actions.forEach(([icon, text], i) => {
      const cx = W / 2 + (i - 1) * slot;
      b.icon(`act${i}`, icon, cx - 26, y, 52, on ?? b.color("accent", 40, 700));
      b.text(`act${i}-t`, {
        text,
        x: cx - slot / 2,
        y: y + 64,
        width: slot,
        maxHeight: 40,
        size: [26, 20],
        weight: 600,
        align: "center",
        color: on ?? b.color("muted", 22, 600),
        name: "Ação",
      });
    });
  }
  return { background: bg, objects: [] };
}

/* ------------------------------------------------------------------ */
/* Montagem do slide                                                   */
/* ------------------------------------------------------------------ */

export function renderSlide(c: SlideContext): RenderedSlide {
  const p = c.direction.palette;
  const bg = c.slide.role === "cover" || c.slide.role === "cta" ? p.bg : c.index % 2 === 0 ? p.bgAlt : p.bg;
  const b = new Builder(c, bg);
  const family = FAMILY[c.slide.role];
  const layout = c.layout;
  const r =
    family === "cover"
      ? cover(b, layout)
      : family === "point"
        ? point(b, layout)
        : family === "data"
          ? layout.startsWith("data-") && (c.slide.stat || c.slide.chart)
            ? data(b, layout)
            : point(b, "point-left")
          : family === "list" || family === "steps" || family === "summary"
            ? list(
                b,
                layout.startsWith("summary-") ? (layout === "summary-card" ? "summary-card" : "list-checks") : layout,
              )
            : family === "compare"
              ? c.slide.columns.length === 2
                ? compare(b, layout)
                : list(b, "list-cards")
              : family === "quote"
                ? quote(b, layout)
                : cta(b, layout);
  chrome(b);
  // Continuidade por baixo de tudo: cartões, faixas e imagens cobrem a forma (texto só sobre fundo ou cartão).
  return { background: r.background, objects: [...motif(b), ...b.back, ...b.front] };
}

/** Todos os textos (exceto decorativos) com a cor do fundo atrás — para verificar contraste. */
export function textColors(
  objects: DesignObject[],
): { id: string; color: string; fontSize: number; fontWeight: number }[] {
  return objects
    .filter((o): o is TextObject => o.type === "text" && !o.name.startsWith(DECORATIVE))
    .map((o) => ({
      id: o.id,
      color: typeof o.color === "string" ? o.color : "#000000",
      fontSize: o.fontSize,
      fontWeight: o.fontWeight,
    }));
}
