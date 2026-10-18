/*
 * Especificações de publicação por rede social, usadas pela pré-visualização e
 * pelo verificador. Ficam todas aqui para serem atualizadas num lugar só quando
 * as redes mudarem as regras. São referências práticas (revisadas em
 * out/2026), não a validação oficial das redes: a interface sempre deixa isso
 * claro, e as redes marcadas como "aproximada" usam medidas aproximadas.
 */

export type PlacementKind = "feed" | "carousel" | "stories";

export type PlacementSpec = {
  label: string;
  kind: PlacementKind;
  /** Proporções aceitas (largura ÷ altura). No carrossel, todas as páginas usam a da primeira. */
  ratios: { label: string; value: number }[];
  /** Tamanho recomendado (px) para a proporção principal. */
  recommended: { width: number; height: number };
  /** Abaixo desta largura a imagem tende a perder nitidez. */
  minWidth: number;
  /** Margem de segurança nas bordas (fração do lado) para textos e logotipos. */
  edgeMargin: number;
  /** Faixas que a interface da rede costuma cobrir (fração da altura). */
  safeArea?: { top: number; bottom: number };
  /** Quantidade de páginas (carrossel). */
  slides?: { min: number; max: number };
  /** Como a rede trata uma imagem fora das proporções aceitas. */
  outOfRange: "crop" | "letterbox";
  note?: string;
};

export type NetworkSpec = {
  label: string;
  /** "reference" = medidas de referência conhecidas; "approximate" = simulação aproximada. */
  fidelity: "reference" | "approximate";
  caption: { max: number; preview: number; hashtagsMax?: number };
  placements: Partial<Record<PlacementKey, PlacementSpec>>;
  /** Avisos fixos mostrados junto da simulação. */
  notes: string[];
};

export const PLACEMENT_KEYS = ["feed_portrait", "feed_square", "feed_landscape", "carousel", "stories"] as const;
export type PlacementKey = (typeof PLACEMENT_KEYS)[number];

export const NETWORK_KEYS = ["instagram", "facebook", "linkedin"] as const;
export type NetworkKey = (typeof NETWORK_KEYS)[number];

const PORTRAIT = { label: "4:5", value: 4 / 5 };
const SQUARE = { label: "1:1", value: 1 };
const LANDSCAPE = { label: "1,91:1", value: 1.91 };
const VERTICAL = { label: "9:16", value: 9 / 16 };

export const SOCIAL_SPECS: Record<NetworkKey, NetworkSpec> = {
  instagram: {
    label: "Instagram",
    fidelity: "reference",
    caption: { max: 2200, preview: 125, hashtagsMax: 30 },
    notes: [],
    placements: {
      feed_portrait: {
        label: "Feed retrato (4:5)",
        kind: "feed",
        ratios: [PORTRAIT],
        recommended: { width: 1080, height: 1350 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "crop",
      },
      feed_square: {
        label: "Feed quadrado (1:1)",
        kind: "feed",
        ratios: [SQUARE],
        recommended: { width: 1080, height: 1080 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "crop",
      },
      feed_landscape: {
        label: "Feed paisagem (1,91:1)",
        kind: "feed",
        ratios: [LANDSCAPE],
        recommended: { width: 1080, height: 566 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "crop",
      },
      carousel: {
        label: "Carrossel",
        kind: "carousel",
        ratios: [PORTRAIT, SQUARE, LANDSCAPE],
        recommended: { width: 1080, height: 1350 },
        minWidth: 1080,
        edgeMargin: 0.04,
        slides: { min: 2, max: 20 },
        outOfRange: "crop",
        note: "Todas as páginas aparecem com a proporção da primeira.",
      },
      stories: {
        label: "Stories (9:16)",
        kind: "stories",
        ratios: [VERTICAL],
        recommended: { width: 1080, height: 1920 },
        minWidth: 1080,
        edgeMargin: 0.05,
        // Cerca de 250 px no topo e 340 px embaixo (em 1080 × 1920) ficam sob a interface.
        safeArea: { top: 250 / 1920, bottom: 340 / 1920 },
        outOfRange: "letterbox",
      },
    },
  },
  facebook: {
    label: "Facebook",
    fidelity: "approximate",
    caption: { max: 63206, preview: 480 },
    notes: ["Simulação aproximada do Facebook: medidas e cortes podem variar conforme o aparelho."],
    placements: {
      feed_portrait: {
        label: "Feed retrato (4:5)",
        kind: "feed",
        ratios: [PORTRAIT],
        recommended: { width: 1080, height: 1350 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "crop",
      },
      feed_square: {
        label: "Feed quadrado (1:1)",
        kind: "feed",
        ratios: [SQUARE],
        recommended: { width: 1080, height: 1080 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "crop",
      },
      feed_landscape: {
        label: "Feed paisagem (1,91:1)",
        kind: "feed",
        ratios: [LANDSCAPE],
        recommended: { width: 1200, height: 630 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "crop",
      },
      carousel: {
        label: "Carrossel",
        kind: "carousel",
        ratios: [SQUARE, PORTRAIT],
        recommended: { width: 1080, height: 1080 },
        minWidth: 1080,
        edgeMargin: 0.04,
        slides: { min: 2, max: 10 },
        outOfRange: "crop",
        note: "O carrossel do Facebook costuma exibir as páginas quadradas.",
      },
      stories: {
        label: "Stories (9:16)",
        kind: "stories",
        ratios: [VERTICAL],
        recommended: { width: 1080, height: 1920 },
        minWidth: 1080,
        edgeMargin: 0.05,
        safeArea: { top: 250 / 1920, bottom: 340 / 1920 },
        outOfRange: "letterbox",
      },
    },
  },
  linkedin: {
    label: "LinkedIn",
    fidelity: "approximate",
    caption: { max: 3000, preview: 210 },
    notes: [
      "Simulação aproximada do LinkedIn.",
      "No LinkedIn, carrosséis costumam ser publicados como documento (PDF): exporte em PDF no editor.",
    ],
    placements: {
      feed_square: {
        label: "Feed quadrado (1:1)",
        kind: "feed",
        ratios: [SQUARE],
        recommended: { width: 1200, height: 1200 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "letterbox",
      },
      feed_portrait: {
        label: "Feed retrato (4:5)",
        kind: "feed",
        ratios: [PORTRAIT],
        recommended: { width: 1080, height: 1350 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "letterbox",
      },
      feed_landscape: {
        label: "Feed paisagem (1,91:1)",
        kind: "feed",
        ratios: [LANDSCAPE],
        recommended: { width: 1200, height: 627 },
        minWidth: 1080,
        edgeMargin: 0.04,
        outOfRange: "letterbox",
      },
      carousel: {
        label: "Documento / carrossel",
        kind: "carousel",
        ratios: [SQUARE, PORTRAIT],
        recommended: { width: 1080, height: 1350 },
        minWidth: 1080,
        edgeMargin: 0.04,
        slides: { min: 2, max: 20 },
        outOfRange: "letterbox",
      },
    },
  },
};

export const isNetworkKey = (v: unknown): v is NetworkKey => NETWORK_KEYS.includes(v as NetworkKey);
export const isPlacementKey = (v: unknown): v is PlacementKey => PLACEMENT_KEYS.includes(v as PlacementKey);

/** Formato (proporção) mais próximo de uma página, entre os aceitos pela rede. */
export function closestFeedPlacement(network: NetworkKey, width: number, height: number): PlacementKey {
  const ratio = width / Math.max(1, height);
  const options = (["feed_portrait", "feed_square", "feed_landscape"] as const).filter(
    (k) => SOCIAL_SPECS[network].placements[k],
  );
  let best: PlacementKey = options[0] ?? "feed_square";
  let diff = Infinity;
  for (const k of options) {
    const d = Math.abs(Math.log(ratio / SOCIAL_SPECS[network].placements[k]!.ratios[0]!.value));
    if (d < diff) {
      diff = d;
      best = k;
    }
  }
  return best;
}

/**
 * Formato inicial da prévia: o salvo na peça (se a rede aceitar), senão o que
 * corresponde ao tipo da peça e ao tamanho da arte.
 */
export function defaultPlacement(
  network: NetworkKey,
  o: { saved?: string | null; contentFormat?: string | null; pages: number; width: number; height: number },
): PlacementKey {
  const spec = SOCIAL_SPECS[network];
  if (isPlacementKey(o.saved) && spec.placements[o.saved]) return o.saved;
  const ratio = o.width / Math.max(1, o.height);
  if ((o.contentFormat === "stories" || o.contentFormat === "reels" || ratio < 0.7) && spec.placements.stories) {
    return "stories";
  }
  if ((o.contentFormat === "carousel" || o.pages > 1) && spec.placements.carousel) return "carousel";
  return closestFeedPlacement(network, o.width, o.height);
}

export function placementsOf(network: NetworkKey): { key: PlacementKey; spec: PlacementSpec }[] {
  return PLACEMENT_KEYS.flatMap((key) => {
    const spec = SOCIAL_SPECS[network].placements[key];
    return spec ? [{ key, spec }] : [];
  });
}
