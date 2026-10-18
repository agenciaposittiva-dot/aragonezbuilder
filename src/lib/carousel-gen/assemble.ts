import {
  createDocument,
  type DesignDocument,
  type DesignObject,
  type DesignPage,
  type TextObject,
} from "@/lib/design-doc";
import { SLIDE_ROLE_LABEL, type GeneratorMeta, type GeneratorSlide } from "@/lib/design-doc/generator";
import { pick, rand } from "./direction";
import { iconForText, type IconName } from "./icons";
import { chooseLayout, layoutAllowed, LAYOUTS, NEEDS_IMAGE, renderSlide } from "./layouts";

/*
 * Montagem do carrossel no formato do editor: uma página por slide (todas do
 * mesmo tamanho, conectadas), objetos com identificadores estáveis por slide
 * e o plano completo em meta.generator.
 */

export const FORMAT_SIZE = {
  portrait: { width: 1080, height: 1350, preset: "carousel-portrait" },
  square: { width: 1080, height: 1080, preset: "carousel-square" },
} as const;

export function topicIcon(meta: Pick<GeneratorMeta, "input" | "direction">): IconName {
  return (
    iconForText(`${meta.input.topic} ${meta.input.objective}`) ??
    pick(["sparkle", "bulb", "target", "star"] as const, meta.direction.seed, 21)
  );
}

const FAMILY_OF = (r: GeneratorSlide["role"]) => (r === "problem" || r === "context" || r === "insight" ? "point" : r);

/**
 * Composição de cada slide. Mesma família → mesma composição base, com uma
 * alternativa nas repetições (ritmo A-B-A). `avoid` (segunda versão) troca a
 * composição de cada slide sempre que houver outra possível.
 */
export function assignLayouts(slides: GeneratorSlide[], seed: number, avoid: string[] = []): GeneratorSlide[] {
  const seen = new Map<string, number>();
  return slides.map((s, i) => {
    const fam = FAMILY_OF(s.role);
    const n = seen.get(fam) ?? 0;
    seen.set(fam, n + 1);
    const base = chooseLayout(s, seed, avoid[i]);
    let layout = base;
    if (n % 2 === 1) {
      const alt = LAYOUTS[s.role].filter(
        (l) => l !== base && l !== avoid[i] && layoutAllowed(l, s) && (!s.visual.image || NEEDS_IMAGE.has(l)),
      );
      if (alt.length) layout = alt[Math.floor(rand(seed, 40 + i) * alt.length)]!;
    }
    return { ...s, layout };
  });
}

export function renderGeneratedPage(meta: GeneratorMeta, index: number): DesignPage {
  const size = FORMAT_SIZE[meta.input.format];
  const slide = meta.slides[index]!;
  const r = renderSlide({
    W: size.width,
    H: size.height,
    index,
    total: meta.slides.length,
    direction: meta.direction,
    slide,
    layout: slide.layout || chooseLayout(slide, meta.direction.seed),
    topicIcon: topicIcon(meta),
    ctaLabel: meta.plan.cta || "Salve este post",
  });
  return {
    id: slide.pageId,
    name: `${index + 1}. ${SLIDE_ROLE_LABEL[slide.role]}`,
    width: size.width,
    height: size.height,
    background: r.background,
    objects: r.objects,
  };
}

export function assembleDocument(meta: GeneratorMeta): DesignDocument {
  const size = FORMAT_SIZE[meta.input.format];
  const doc = createDocument({
    pages: meta.slides.map(() => ({ width: size.width, height: size.height })),
    carousel: true,
    preset: size.preset,
  });
  doc.pages = meta.slides.map((_, i) => renderGeneratedPage(meta, i));
  doc.meta = { ...doc.meta, carousel: true, preset: size.preset, generator: meta };
  return doc;
}

/* ------------------------------------------------------------------ */
/* Leitura dos textos editados (para trocar a direção sem perder edições) */
/* ------------------------------------------------------------------ */

function findText(objects: DesignObject[], id: string): TextObject | null {
  for (const o of objects) {
    if (o.id === id && o.type === "text") return o;
    if (o.type === "group") {
      const f = findText(o.children, id);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Textos atuais do slide no documento (a pessoa pode ter editado no editor).
 * Texto igual ao gerado em maiúsculas volta para a grafia original.
 */
export function readSlideTexts(page: DesignPage | undefined, slide: GeneratorSlide): GeneratorSlide {
  if (!page) return slide;
  const get = (part: string, original: string) => {
    const t = findText(page.objects, `${slide.key}-${part}`);
    if (!t) return original;
    return t.text === original.toUpperCase() ? original : t.text;
  };
  return {
    ...slide,
    kicker: get("kicker", slide.kicker),
    title: get("title", slide.title),
    body: get("body", slide.body),
    bullets: slide.bullets.map((b, i) => get(`b${i}`, b)),
    columns: slide.columns.map((c, i) => ({
      label: get(`c${i}-label`, c.label),
      items: c.items.map((it, j) => get(`c${i}-i${j}`, it)),
    })),
    stat: slide.stat
      ? { ...slide.stat, value: get("stat", slide.stat.value), label: get("statlabel", slide.stat.label) }
      : null,
  };
}

/** Slides do plano com os textos atuais do documento. */
export function currentSlides(doc: DesignDocument, meta: GeneratorMeta): GeneratorSlide[] {
  return meta.slides.map((s) =>
    readSlideTexts(
      doc.pages.find((p) => p.id === s.pageId),
      s,
    ),
  );
}
