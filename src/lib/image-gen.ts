import { coverCrop, imageObject, type DesignOp, type DesignPage, type ImageObject } from "./design-doc";

/*
 * Geração de imagens por IA dentro do editor (Estúdio Criador → Gerar imagem).
 * Regras puras compartilhadas entre a interface e o servidor (que sempre
 * revalida): formatos, estilos, opções que cada provedor realmente aceita,
 * montagem do prompt e operações de inserção na arte. Nenhum parâmetro ou
 * modelo é inventado — os modelos vêm da listagem do provedor (seletor
 * universal) e as opções abaixo seguem a documentação oficial da API usada.
 */

export const IMAGE_GEN_LIMITS = {
  prompt: 4000,
  negativePrompt: 1000,
  variations: 4,
  /** Lado máximo da proporção personalizada (1 a 32). */
  customRatio: 32,
  /** Proporção extrema aceita (ex.: 3:1); além disso a imagem recortada ficaria pequena demais. */
  maxAspect: 3,
} as const;

/* ------------------------------------------------------------------ */
/* Formatos                                                            */
/* ------------------------------------------------------------------ */

export type Ratio = { w: number; h: number };

export const IMAGE_FORMATS = {
  square: { label: "Quadrado", ratio: "1:1", w: 1, h: 1 },
  portrait: { label: "Retrato para feed", ratio: "4:5", w: 4, h: 5 },
  story: { label: "Vertical", ratio: "9:16", w: 9, h: 16 },
  landscape: { label: "Paisagem", ratio: "16:9", w: 16, h: 9 },
  /** Proporção da página (slide) ativa no editor. */
  page: { label: "Formato do slide", ratio: "", w: 0, h: 0 },
  custom: { label: "Personalizado", ratio: "", w: 0, h: 0 },
} as const satisfies Record<string, { label: string; ratio: string; w: number; h: number }>;
export type ImageFormatKey = keyof typeof IMAGE_FORMATS;
export const IMAGE_FORMAT_KEYS = Object.keys(IMAGE_FORMATS) as ImageFormatKey[];

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** "4:5", "9:16"… a partir de medidas (reduzida pelo máximo divisor comum; medidas grandes viram decimais). */
export function ratioLabel(r: Ratio): string {
  const g = gcd(Math.round(r.w), Math.round(r.h)) || 1;
  const w = Math.round(r.w) / g;
  const h = Math.round(r.h) / g;
  if (w <= 64 && h <= 64) return `${w}:${h}`;
  return `${(r.w / r.h).toFixed(2).replace(/\.?0+$/, "")}:1`;
}

/**
 * Proporção pedida: dos formatos fixos, da página ativa ("page") ou
 * personalizada. Null quando faltam dados (sem página ou personalizada inválida).
 */
export function ratioOf(
  format: ImageFormatKey,
  page: { width: number; height: number } | null,
  custom: Ratio | null,
): Ratio | null {
  if (format === "page") return page && page.width > 0 && page.height > 0 ? { w: page.width, h: page.height } : null;
  if (format === "custom") {
    if (!custom) return null;
    const ok = (n: number) => Number.isFinite(n) && n >= 1 && n <= IMAGE_GEN_LIMITS.customRatio;
    if (!ok(custom.w) || !ok(custom.h)) return null;
    const aspect = custom.w / custom.h;
    if (aspect > IMAGE_GEN_LIMITS.maxAspect || aspect < 1 / IMAGE_GEN_LIMITS.maxAspect) return null;
    return { w: custom.w, h: custom.h };
  }
  const f = IMAGE_FORMATS[format];
  return { w: f.w, h: f.h };
}

/* ------------------------------------------------------------------ */
/* Estilos (viram texto no prompt; valem para qualquer provedor)       */
/* ------------------------------------------------------------------ */

export const IMAGE_STYLES = {
  none: { label: "Sem estilo definido", prompt: "" },
  photographic: {
    label: "Fotográfico",
    prompt: "Fotografia realista, luz natural, lente de 50 mm, texturas e profundidade de campo verossímeis.",
  },
  cinematic: {
    label: "Cinematográfico",
    prompt:
      "Estética cinematográfica, iluminação dramática com contraste controlado, paleta coesa e atmosfera de filme.",
  },
  editorial: {
    label: "Editorial",
    prompt: "Estilo editorial de revista, composição elegante com respiro, cores sóbrias e acabamento refinado.",
  },
  minimalist: {
    label: "Minimalista",
    prompt: "Composição minimalista, poucos elementos, fundo limpo, muito espaço negativo e formas simples.",
  },
  "3d": {
    label: "3D",
    prompt: "Render 3D de alta qualidade, materiais realistas, iluminação de estúdio e sombras suaves.",
  },
  illustration: {
    label: "Ilustração",
    prompt: "Ilustração digital com traço limpo, cores planas harmoniosas e estilo gráfico contemporâneo.",
  },
  futuristic: {
    label: "Futurista",
    prompt: "Visual futurista, superfícies tecnológicas, luzes de neon sutis e sensação de inovação.",
  },
  advertising: {
    label: "Publicitário",
    prompt:
      "Fotografia publicitária de campanha premium, produto em destaque, iluminação de estúdio e acabamento comercial impecável.",
  },
} as const satisfies Record<string, { label: string; prompt: string }>;
export type ImageStyleKey = keyof typeof IMAGE_STYLES;
export const IMAGE_STYLE_KEYS = Object.keys(IMAGE_STYLES) as ImageStyleKey[];

/* ------------------------------------------------------------------ */
/* Opções por provedor (só o que a API oficial aceita)                 */
/* ------------------------------------------------------------------ */

/** Qualidade da Images API da OpenAI para os modelos gpt-image (`quality`: auto, low, medium, high). */
export const OPENAI_IMAGE_QUALITIES = {
  auto: "Automática",
  low: "Rápida (baixa)",
  medium: "Padrão (média)",
  high: "Alta",
} as const;

export type ImageProviderOptions = {
  /** Tamanhos gerados pela API (a proporção pedida é obtida por recorte do mais próximo). */
  sizes: { w: number; h: number }[];
  /** Níveis de qualidade aceitos (null = o provedor não oferece a opção). */
  qualities: Record<string, string> | null;
  /** Quantas variações podem ser pedidas de uma vez. */
  maxVariations: number;
  /** A API aceita instruções negativas (o que evitar) como parâmetro próprio. */
  negativePrompt: boolean;
};

export const IMAGE_PROVIDER_OPTIONS: Record<string, ImageProviderOptions> = {
  // POST /v1/images/generations (gpt-image-*): size 1024x1024 | 1536x1024 | 1024x1536 | auto,
  // quality auto | low | medium | high, n 1–10. Não há parâmetro de prompt negativo.
  openai: {
    sizes: [
      { w: 1024, h: 1024 },
      { w: 1536, h: 1024 },
      { w: 1024, h: 1536 },
    ],
    qualities: OPENAI_IMAGE_QUALITIES,
    maxVariations: IMAGE_GEN_LIMITS.variations,
    negativePrompt: false,
  },
};

export function imageProviderOptions(provider: string | null | undefined): ImageProviderOptions | null {
  return provider ? (IMAGE_PROVIDER_OPTIONS[provider] ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* Tamanho pedido ao provedor e recorte para a proporção escolhida     */
/* ------------------------------------------------------------------ */

/** Tamanho gerado mais próximo da proporção pedida (ex.: 4:5 → 1024×1536). */
export function providerSizeFor(ratio: Ratio, sizes: { w: number; h: number }[]): { w: number; h: number } {
  const want = Math.log(ratio.w / ratio.h);
  return [...sizes].sort((a, b) => Math.abs(Math.log(a.w / a.h) - want) - Math.abs(Math.log(b.w / b.h) - want))[0]!;
}

export const sizeParam = (s: { w: number; h: number }) => `${s.w}x${s.h}`;

/** Recorte central da imagem gerada para a proporção exata (maior área possível). */
export function cropToRatio(size: { w: number; h: number }, ratio: Ratio) {
  const target = ratio.w / ratio.h;
  let width = size.w;
  let height = Math.round(size.w / target);
  if (height > size.h) {
    height = size.h;
    width = Math.round(size.h * target);
  }
  width = Math.max(1, Math.min(size.w, width));
  height = Math.max(1, Math.min(size.h, height));
  return { width, height, left: Math.floor((size.w - width) / 2), top: Math.floor((size.h - height) / 2) };
}

/** Medidas finais da imagem para a proporção pedida (o que a pessoa vê no painel antes de gerar). */
export function outputSizeFor(ratio: Ratio, sizes: { w: number; h: number }[]) {
  const base = providerSizeFor(ratio, sizes);
  const crop = cropToRatio(base, ratio);
  return { base, width: crop.width, height: crop.height };
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

export type ImageContextMode = "none" | "slide" | "carousel";
export const IMAGE_CONTEXT_LABEL: Record<ImageContextMode, string> = {
  none: "Sem contexto",
  slide: "Slide atual",
  carousel: "Carrossel inteiro",
};

/**
 * Texto final enviado ao provedor: a descrição da pessoa, o estilo escolhido,
 * o que evitar (só em texto, quando a API não tem parâmetro próprio) e o
 * contexto do slide/carrossel montado no servidor.
 */
export function buildImagePrompt(o: {
  prompt: string;
  style?: ImageStyleKey | null;
  negativePrompt?: string | null;
  context?: string | null;
}): string {
  const parts = [o.prompt.trim()];
  const style = o.style && o.style !== "none" ? IMAGE_STYLES[o.style]?.prompt : "";
  if (style) parts.push(`Estilo: ${style}`);
  const avoid = o.negativePrompt?.trim();
  if (avoid) parts.push(`Evite: ${avoid}`);
  const context = o.context?.trim();
  if (context) parts.push(context);
  return parts.join("\n\n").slice(0, IMAGE_GEN_LIMITS.prompt);
}

/* ------------------------------------------------------------------ */
/* Inserção na arte (operações do editor; nada paralelo às camadas)    */
/* ------------------------------------------------------------------ */

export type GeneratedImageRef = { src: string; width: number; height: number; name: string };
export type InsertImageMode = "element" | "background" | "replace";

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Operações para colocar a imagem gerada na página informada:
 * - element: elemento novo centralizado, cabendo em 80% da página (proporção mantida);
 * - background: camada no fundo cobrindo a página inteira (recorte "preencher");
 * - replace: troca a imagem do elemento `targetId` mantendo a caixa e o enquadramento.
 * Devolve também o id do elemento resultante, para selecioná-lo.
 */
export function insertImageOps(
  page: Pick<DesignPage, "id" | "width" | "height">,
  image: GeneratedImageRef,
  mode: InsertImageMode,
  targetId?: string | null,
): { ops: DesignOp[]; id: string } {
  const natural = { width: image.width, height: image.height };
  if (mode === "replace") {
    if (!targetId) throw new Error("Selecione a imagem a substituir.");
    return {
      ops: [
        {
          op: "replaceImage",
          id: targetId,
          src: image.src,
          naturalWidth: image.width,
          naturalHeight: image.height,
          fit: "fill",
        },
      ],
      id: targetId,
    };
  }
  if (mode === "background") {
    const box = { width: page.width, height: page.height };
    const bg: ImageObject = imageObject({
      src: image.src,
      naturalWidth: image.width,
      naturalHeight: image.height,
      name: image.name,
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
      crop: coverCrop(natural, box),
    });
    return { ops: [{ op: "add", pageId: page.id, object: bg, index: 0 }], id: bg.id };
  }
  const img = imageObject({
    src: image.src,
    naturalWidth: image.width,
    naturalHeight: image.height,
    name: image.name,
    fitWithin: { width: page.width * 0.8, height: page.height * 0.8 },
  });
  img.x = round((page.width - img.width) / 2);
  img.y = round((page.height - img.height) / 2);
  return { ops: [{ op: "add", pageId: page.id, object: img }], id: img.id };
}

export const INSERT_MODE_LABEL: Record<InsertImageMode, string> = {
  element: "Adicionar como novo elemento",
  background: "Inserir como fundo do slide",
  replace: "Substituir a imagem selecionada",
};
