import { aabbOf, intersects, type Box } from "@/lib/design-doc/geometry";
import type { DesignObject, Paint } from "@/lib/design-doc/schema";
import { SOCIAL_SPECS, type NetworkKey, type PlacementKey, type PlacementSpec } from "@/lib/social-specs";

/*
 * Verificador da pré-visualização: confere as páginas salvas (camadas do
 * editor ou arquivos de mídia), a legenda e as regras da rede escolhida.
 * Roda igual no servidor e no navegador, sem acessar nada externo. É uma
 * validação interna da plataforma — não substitui as regras oficiais da rede.
 */

export type CheckSlide = {
  key: string;
  label: string;
  width: number;
  height: number;
  /** Camadas da página (artes do editor). Ausente em arquivos de mídia. */
  objects?: DesignObject[];
  background?: Paint | null;
  designId?: string;
  pageId?: string;
  /** Arquivos de mídia (sem camadas). */
  mimeType?: string;
  /** Carrossel com páginas conectadas: objetos podem atravessar de uma página para a vizinha. */
  connected?: { first: boolean; last: boolean };
};

export type CheckInput = {
  network: NetworkKey;
  placement: PlacementKey;
  slides: CheckSlide[];
  caption: string | null;
  hashtags: string[];
  cta?: string | null;
  /** Peças com legenda (conteúdo). Artes avulsas do Estúdio não têm legenda. */
  hasCaption: boolean;
  exports?: { stale: boolean; exported: number; total: number } | null;
  /** Versões do logotipo cadastrado do cliente, quando houver. */
  brandLogoVersionIds?: string[];
};

export type CheckLevel = "error" | "warning" | "suggestion";

export type CheckIssue = {
  level: CheckLevel;
  code: string;
  message: string;
  slideKey?: string;
  objectId?: string;
};

export const CHECK_LEVEL_LABEL: Record<CheckLevel, string> = {
  error: "Precisa corrigir",
  warning: "Merece atenção",
  suggestion: "Sugestão",
};

const RATIO_TOLERANCE = 0.02;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export function runPreviewChecks(input: CheckInput): CheckIssue[] {
  const net = SOCIAL_SPECS[input.network];
  const spec = net.placements[input.placement];
  const out: CheckIssue[] = [];
  const add = (level: CheckLevel, code: string, message: string, extra: Partial<CheckIssue> = {}) =>
    out.push({ level, code, message, ...extra });

  if (!spec) {
    add("error", "placement_unsupported", `${net.label} não tem o formato escolhido.`);
    return out;
  }
  if (!input.slides.length) {
    add("error", "no_media", "Nenhuma arte ou imagem ligada a esta peça. Crie a arte no editor ou anexe a mídia.");
  } else {
    checkFormat(input, spec, add);
    input.slides.forEach((slide, i) => checkSlide(input, spec, slide, i, add));
    checkDuplicates(input.slides, add);
    if (spec.kind === "carousel") checkMargins(input.slides, add);
  }
  // Stories não têm legenda de publicação.
  if (input.hasCaption && spec.kind !== "stories") checkCaption(input, add);
  if (input.exports) {
    if (input.exports.stale) {
      add(
        "warning",
        "export_stale",
        "A arte mudou depois da última exportação. Exporte de novo antes de enviar ao cliente.",
      );
    }
    if (input.exports.total > 0 && input.exports.exported < input.exports.total) {
      add(
        "suggestion",
        "export_missing",
        `Exporte as páginas para Arquivos (${input.exports.exported} de ${input.exports.total} exportadas) para enviar ao cliente aprovar.`,
      );
    }
  }
  const order: Record<CheckLevel, number> = { error: 0, warning: 1, suggestion: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

type Add = (level: CheckLevel, code: string, message: string, extra?: Partial<CheckIssue>) => void;

function ratioOk(spec: PlacementSpec, width: number, height: number) {
  const r = width / Math.max(1, height);
  return spec.ratios.some((x) => Math.abs(r / x.value - 1) <= RATIO_TOLERANCE);
}

const ratioLabel = (spec: PlacementSpec) => spec.ratios.map((r) => r.label).join(", ");

function checkFormat(input: CheckInput, spec: PlacementSpec, add: Add) {
  const slides = input.slides;
  const first = slides[0]!;
  if (spec.kind === "carousel") {
    if (spec.slides && slides.length < spec.slides.min) {
      add(
        "error",
        "carousel_too_short",
        `Carrossel com ${slides.length} página: são necessárias pelo menos ${spec.slides.min}.`,
      );
    }
    if (spec.slides && slides.length > spec.slides.max) {
      add("error", "carousel_too_long", `Carrossel com ${slides.length} páginas: o limite é ${spec.slides.max}.`);
    }
    if (!ratioOk(spec, first.width, first.height)) {
      add(
        "error",
        "ratio",
        `A primeira página (${first.width} × ${first.height}) não está numa proporção aceita (${ratioLabel(spec)}); ${spec.outOfRange === "crop" ? "ela será cortada" : "ela aparecerá com faixas"}.`,
        { slideKey: first.key },
      );
    }
    slides.slice(1).forEach((s) => {
      if (s.width !== first.width || s.height !== first.height) {
        add(
          "error",
          "carousel_size_mismatch",
          `${s.label} tem ${s.width} × ${s.height}, diferente da primeira (${first.width} × ${first.height}). No carrossel, todas aparecem no tamanho da primeira.`,
          { slideKey: s.key },
        );
      }
    });
    return;
  }
  if (slides.length > 1 && spec.kind === "feed") {
    add(
      "warning",
      "feed_multiple",
      `A peça tem ${slides.length} páginas, mas no feed só a primeira aparece. Para mostrar todas, use Carrossel.`,
    );
  }
  for (const s of spec.kind === "stories" ? slides : [first]) {
    if (!ratioOk(spec, s.width, s.height)) {
      add(
        spec.outOfRange === "crop" ? "error" : "warning",
        "ratio",
        `${s.label} (${s.width} × ${s.height}) não está na proporção ${ratioLabel(spec)}: ${spec.outOfRange === "crop" ? "a rede vai cortar a imagem" : "ela aparecerá com faixas nas bordas"}.`,
        { slideKey: s.key },
      );
    }
  }
}

function checkSlide(input: CheckInput, spec: PlacementSpec, slide: CheckSlide, index: number, add: Add) {
  if (slide.width < spec.minWidth) {
    add(
      "warning",
      "low_resolution",
      `${slide.label}: ${slide.width} px de largura, abaixo do recomendado (${spec.minWidth} px). Pode perder nitidez.`,
      { slideKey: slide.key },
    );
  }
  if (!slide.objects) {
    const t = slide.mimeType ?? "";
    const ok = MEDIA_TYPES.includes(t) || (spec.kind === "stories" && VIDEO_TYPES.includes(t));
    if (!ok) {
      add(
        "error",
        "media_type",
        `${slide.label}: tipo de arquivo (${t || "desconhecido"}) incompatível com o formato.`,
        {
          slideKey: slide.key,
        },
      );
    }
    return;
  }
  const visible = flatten(slide.objects).filter((o) => !o.hidden && o.opacity > 0);
  if (!visible.length) {
    add("warning", "empty_page", `${slide.label} está em branco.`, { slideKey: slide.key });
    return;
  }
  const page: Box = { x: 0, y: 0, width: slide.width, height: slide.height };
  const margin = spec.edgeMargin * Math.min(slide.width, slide.height);
  const conn = slide.connected;
  for (const o of visible) {
    const b = aabbOf(o);
    const name = describe(o);
    if (!intersects(b, page)) {
      // No carrossel conectado, o que passa para a página vizinha é intencional.
      if (!conn) {
        add("warning", "outside", `${slide.label}: ${name} está fora da página e não vai aparecer.`, {
          slideKey: slide.key,
          objectId: o.id,
        });
      }
      continue;
    }
    const overLeft = b.x < -0.5 && (!conn || conn.first);
    const overRight = b.x + b.width > slide.width + 0.5 && (!conn || conn.last);
    const overV = b.y < -0.5 || b.y + b.height > slide.height + 0.5;
    if (o.type === "text") {
      if (overLeft || overRight || overV) {
        add("error", "text_cut", `${slide.label}: ${name} passa da borda e fica cortado.`, {
          slideKey: slide.key,
          objectId: o.id,
        });
      } else if (
        (b.x < margin && (!conn || conn.first)) ||
        (b.x + b.width > slide.width - margin && (!conn || conn.last)) ||
        b.y < margin ||
        b.y + b.height > slide.height - margin
      ) {
        add(
          "warning",
          "near_edge",
          `${slide.label}: ${name} está muito perto da borda e pode ser cortado em algumas telas.`,
          { slideKey: slide.key, objectId: o.id },
        );
      }
      if (o.fontSize < slide.width * 0.022) {
        add(
          "suggestion",
          "small_text",
          `${slide.label}: ${name} tem fonte pequena (${Math.round(o.fontSize)} px) e pode ficar ilegível no celular.`,
          { slideKey: slide.key, objectId: o.id },
        );
      }
      const contrast = textContrast(o, visible, slide);
      if (contrast !== null) {
        const large = o.fontSize >= slide.width * 0.04 || (o.fontSize >= slide.width * 0.03 && o.fontWeight >= 700);
        if (contrast < (large ? 3 : 4.5)) {
          add(
            "warning",
            "contrast",
            `${slide.label}: ${name} tem pouco contraste com o fundo (${contrast.toFixed(1)}:1). Recomendado: ${large ? "3" : "4,5"}:1 ou mais.`,
            { slideKey: slide.key, objectId: o.id },
          );
        }
      }
    }
    if (o.type === "image") {
      const naturalW = o.crop?.width ?? o.naturalWidth;
      if (naturalW && naturalW < b.width * 0.8) {
        add(
          "warning",
          "image_upscaled",
          `${slide.label}: ${name} está ampliada além do tamanho original e pode ficar pixelada.`,
          { slideKey: slide.key, objectId: o.id },
        );
      }
      if (/logo/i.test(o.name) && (overLeft || overRight || overV)) {
        add("error", "logo_cut", `${slide.label}: o logotipo passa da borda e fica cortado.`, {
          slideKey: slide.key,
          objectId: o.id,
        });
      }
    }
    if (spec.kind === "stories" && o.type === "text" && STICKER_WORDS.test(o.text)) {
      add(
        "suggestion",
        "simulated_sticker",
        `${slide.label}: ${name} parece um recurso interativo (link, enquete ou pergunta). Na arte ele é só imagem: adicione o recurso de verdade no aplicativo da rede ao publicar.`,
        { slideKey: slide.key, objectId: o.id },
      );
    }
    if (spec.safeArea && (o.type === "text" || /logo|bot[aã]o|cta/i.test(o.name))) {
      const top = spec.safeArea.top * slide.height;
      const bottom = slide.height - spec.safeArea.bottom * slide.height;
      if (b.y < top || b.y + b.height > bottom) {
        add(
          "warning",
          "unsafe_area",
          `${slide.label}: ${name} fica ${b.y < top ? "no topo" : "no rodapé"}, área que a interface do Stories costuma cobrir.`,
          { slideKey: slide.key, objectId: o.id },
        );
      }
    }
  }
  if (input.brandLogoVersionIds?.length && index === 0) {
    const all = input.slides.flatMap((s) => (s.objects ? flatten(s.objects) : []));
    const hasLogo = all.some((o) => o.type === "image" && input.brandLogoVersionIds!.some((v) => o.src.includes(v)));
    if (!hasLogo) {
      add(
        "suggestion",
        "brand_logo_missing",
        "O logotipo cadastrado do cliente não aparece na arte. Confira se ele é obrigatório para esta marca.",
      );
    }
  }
}

/** Margem esquerda dos textos de cada página do carrossel: diferenças grandes quebram o alinhamento entre slides. */
function checkMargins(slides: CheckSlide[], add: Add) {
  const lefts: { label: string; x: number; width: number }[] = [];
  for (const s of slides) {
    if (!s.objects) continue;
    const xs = flatten(s.objects)
      .filter((o) => o.type === "text" && !o.hidden && o.opacity > 0)
      .map(aabbOf)
      .filter((b) => b.x >= 0 && b.x < s.width)
      .map((b) => b.x);
    if (xs.length) lefts.push({ label: s.label, x: Math.min(...xs), width: s.width });
  }
  if (lefts.length < 3) return;
  const sorted = [...lefts].sort((a, b) => a.x - b.x);
  const median = sorted[Math.floor(sorted.length / 2)]!.x;
  const off = lefts.filter((l) => Math.abs(l.x - median) > l.width * 0.03);
  if (off.length && off.length < lefts.length) {
    add(
      "suggestion",
      "margin_mismatch",
      `Margem dos textos diferente das demais páginas em: ${off.map((l) => l.label).join(", ")}. Alinhe para o carrossel ficar uniforme.`,
    );
  }
}

const STICKER_WORDS =
  /\b(arraste para cima|toque no link|link na bio|clique no link|enquete|caixa de perguntas|responda aqui|vote aqui)\b/i;

function checkDuplicates(slides: CheckSlide[], add: Add) {
  const seen = new Map<string, string>();
  for (const s of slides) {
    if (!s.objects) continue;
    const sig = signature(s);
    const prev = seen.get(sig);
    if (prev) {
      add("warning", "duplicate_slide", `${s.label} é igual a ${prev}.`, { slideKey: s.key });
    } else seen.set(sig, s.label);
  }
}

function checkCaption(input: CheckInput, add: Add) {
  const net = SOCIAL_SPECS[input.network];
  const caption = (input.caption ?? "").trim();
  const tags = input.hashtags.filter(Boolean);
  const full = [caption, tags.join(" ")].filter(Boolean).join("\n\n");
  if (!caption) add("warning", "caption_empty", "A legenda está vazia.");
  if (full.length > net.caption.max) {
    add(
      "error",
      "caption_too_long",
      `A legenda com hashtags tem ${full.length} caracteres; o limite do ${net.label} é ${net.caption.max}.`,
    );
  } else if (caption.length > net.caption.preview) {
    add(
      "suggestion",
      "caption_preview",
      `Só os primeiros ${net.caption.preview} caracteres aparecem antes de “mais”: comece pelo essencial.`,
    );
  }
  if (net.caption.hashtagsMax && tags.length > net.caption.hashtagsMax) {
    add(
      "error",
      "hashtags_too_many",
      `${tags.length} hashtags: o limite do ${net.label} é ${net.caption.hashtagsMax}.`,
    );
  }
  if (caption && !tags.length && input.network === "instagram") {
    add("suggestion", "hashtags_none", "Nenhuma hashtag: considere incluir algumas relevantes para a marca.");
  }
  if (caption && !input.cta?.trim()) {
    add("suggestion", "cta_missing", "Sem chamada para ação: diga o que a pessoa deve fazer depois de ver o post.");
  }
}

/* ------------------------------------------------------------------ */

function flatten(list: DesignObject[]): DesignObject[] {
  return list.flatMap((o) => (o.type === "group" ? flatten(o.children) : [o]));
}

function describe(o: DesignObject) {
  if (o.type === "text") {
    const t = o.text.replace(/\s+/g, " ").trim();
    return `o texto “${t.length > 40 ? `${t.slice(0, 40)}…` : t}”`;
  }
  const kind = o.type === "image" ? "a imagem" : "o elemento";
  return o.name ? `${kind} “${o.name}”` : kind;
}

function signature(s: CheckSlide) {
  const strip = (o: DesignObject): unknown => {
    const { id: _id, name: _name, ...rest } = o as DesignObject & Record<string, unknown>;
    void _id;
    void _name;
    return o.type === "group" ? { ...rest, children: o.children.map(strip) } : rest;
  };
  return JSON.stringify([s.width, s.height, s.background ?? null, (s.objects ?? []).map(strip)]);
}

/* ------------------------------ contraste ----------------------------- */

type RGBA = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  gray: "#808080",
  grey: "#808080",
  transparent: "#00000000",
};

export function parseColor(input: string): RGBA | null {
  const v = (NAMED[input.trim().toLowerCase()] ?? input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    let h = m[1]!;
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  if (!a) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function luminance(c: RGBA) {
  const f = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function contrastRatio(a: RGBA, b: RGBA) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const solid = (p: Paint | null | undefined) => (typeof p === "string" ? parseColor(p) : null);

/**
 * Contraste do texto com o que está atrás dele. Só quando dá para saber com
 * segurança (cores sólidas); sobre imagens ou degradês, não mede (null).
 */
function textContrast(t: Extract<DesignObject, { type: "text" }>, visible: DesignObject[], slide: CheckSlide) {
  const color = solid(t.color);
  if (!color || color.a < 0.99) return null;
  let bg = solid(slide.background ?? "#ffffff");
  if (!bg) return null;
  if (bg.a < 1) bg = over(bg, { r: 255, g: 255, b: 255, a: 1 });
  const tb = aabbOf(t);
  const idx = visible.indexOf(t);
  for (const o of visible.slice(0, idx)) {
    const b = aabbOf(o);
    if (!intersects(b, tb)) continue;
    const covers = b.x <= tb.x && b.y <= tb.y && b.x + b.width >= tb.x + tb.width && b.y + b.height >= tb.y + tb.height;
    // Sobre imagem (ou objeto legado sem cor conhecida) não dá para medir.
    if (o.type === "image" || o.type === "fabric" || o.type === "instance") return null;
    if (
      o.type === "rect" ||
      o.type === "ellipse" ||
      o.type === "triangle" ||
      o.type === "polygon" ||
      o.type === "path"
    ) {
      if (!covers) {
        if (o.type === "rect") return null;
        continue;
      }
      const fill = solid((o as { fill: Paint | null }).fill);
      if (!fill) return null;
      bg = over({ ...fill, a: fill.a * o.opacity }, bg);
    }
  }
  return contrastRatio(color, bg);
}
