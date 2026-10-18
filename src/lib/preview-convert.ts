import { z } from "zod";

/*
 * Conversão de uma peça para outro formato (feed → carrossel ou Stories, e o
 * contrário). A proposta é sempre um rascunho editável; ao aceitar, nasce uma
 * peça nova com artes novas e a original fica como estava.
 */

export const CONVERT_TARGETS = ["carousel", "stories", "feed"] as const;
export type ConvertTarget = (typeof CONVERT_TARGETS)[number];

export const CONVERT_TARGET_LABEL: Record<ConvertTarget, string> = {
  carousel: "Carrossel",
  stories: "Stories",
  feed: "Post de feed",
};

export const conversionSlideSchema = z.object({
  title: z.string().trim().max(200).default(""),
  text: z.string().trim().max(1200).default(""),
});

export const conversionProposalSchema = z.object({
  title: z.string().trim().min(1, "Informe o título").max(200),
  slides: z.array(conversionSlideSchema).min(1, "Inclua pelo menos uma página").max(10),
  caption: z.string().trim().max(4000).nullable().optional(),
  cta: z.string().trim().max(300).nullable().optional(),
});
export type ConversionProposal = z.infer<typeof conversionProposalSchema>;

type Source = {
  title: string;
  copy?: string | null;
  caption?: string | null;
  cta?: string | null;
  slides?: { title: string; text: string }[];
};

function sentences(text: string) {
  return text
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

/**
 * Proposta automática (sem IA) a partir dos textos da peça: título, frases da
 * legenda e chamada para ação. Serve de ponto de partida quando não há
 * provedor de IA disponível ou a política da organização não permite enviar
 * os textos do cliente.
 */
export function automaticProposal(src: Source, target: ConvertTarget): ConversionProposal {
  const points = src.slides?.length
    ? src.slides.map((s) => ({ title: s.title, text: s.text }))
    : sentences([src.copy, src.caption].filter(Boolean).join("\n")).map((t) => ({ title: "", text: t }));
  const cta = src.cta?.trim() || null;
  if (target === "feed") {
    const first = points[0];
    return {
      title: src.title,
      slides: [{ title: src.copy?.trim() || first?.title || src.title, text: first?.text ?? "" }],
      caption: src.caption ?? null,
      cta,
    };
  }
  const max = target === "stories" ? 3 : 5;
  // Frases soltas da legenda viram o título da página; páginas que já existiam mantêm título e texto.
  const body = points.slice(0, max).map((p) => ({ title: p.title || p.text, text: p.title ? p.text : "" }));
  const slides = [{ title: src.copy?.trim() || src.title, text: "" }, ...body];
  if (cta) slides.push({ title: cta, text: "" });
  return { title: src.title, slides: slides.slice(0, 10), caption: src.caption ?? null, cta };
}
