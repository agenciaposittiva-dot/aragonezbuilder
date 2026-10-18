/** Formatos prontos para criar artes (pedido 1.4). Tamanhos em pixels. */
export type FormatPreset = {
  key: string;
  group: "Instagram" | "Carrossel" | "Anúncios" | "Banners e capas" | "Outros";
  label: string;
  width: number;
  height: number;
  /** Carrossel: páginas conectadas, todas do mesmo tamanho. */
  carousel?: boolean;
  /** Quantidade de páginas sugerida ao criar. */
  pages?: number;
};

export const FORMAT_PRESETS: FormatPreset[] = [
  { key: "ig-portrait", group: "Instagram", label: "Instagram · Feed retrato (4:5)", width: 1080, height: 1350 },
  { key: "ig-square", group: "Instagram", label: "Instagram · Feed quadrado", width: 1080, height: 1080 },
  { key: "story", group: "Instagram", label: "Stories e Reels (9:16)", width: 1080, height: 1920 },
  {
    key: "carousel-portrait",
    group: "Carrossel",
    label: "Carrossel · retrato (4:5)",
    width: 1080,
    height: 1350,
    carousel: true,
    pages: 3,
  },
  {
    key: "carousel-square",
    group: "Carrossel",
    label: "Carrossel · quadrado",
    width: 1080,
    height: 1080,
    carousel: true,
    pages: 3,
  },
  { key: "ad-square", group: "Anúncios", label: "Anúncio · feed (1:1)", width: 1080, height: 1080 },
  { key: "ad-landscape", group: "Anúncios", label: "Anúncio · link / paisagem (1,91:1)", width: 1200, height: 628 },
  { key: "ad-story", group: "Anúncios", label: "Anúncio · stories (9:16)", width: 1080, height: 1920 },
  { key: "ad-mrec", group: "Anúncios", label: "Display · retângulo médio", width: 300, height: 250 },
  { key: "ad-halfpage", group: "Anúncios", label: "Display · meia página", width: 300, height: 600 },
  { key: "ad-leaderboard", group: "Anúncios", label: "Display · super banner", width: 728, height: 90 },
  { key: "ad-skyscraper", group: "Anúncios", label: "Display · arranha-céu", width: 160, height: 600 },
  { key: "banner", group: "Banners e capas", label: "Banner web (16:9)", width: 1920, height: 1080 },
  { key: "hero", group: "Banners e capas", label: "Banner de site (topo)", width: 1920, height: 600 },
  { key: "fb-post", group: "Banners e capas", label: "Facebook · post / link", width: 1200, height: 630 },
  { key: "fb-cover", group: "Banners e capas", label: "Facebook · capa", width: 1640, height: 624 },
  { key: "linkedin", group: "Banners e capas", label: "LinkedIn · post", width: 1200, height: 627 },
  { key: "linkedin-cover", group: "Banners e capas", label: "LinkedIn · capa", width: 1584, height: 396 },
  { key: "yt-thumb", group: "Banners e capas", label: "YouTube · miniatura", width: 1280, height: 720 },
  { key: "yt-banner", group: "Banners e capas", label: "YouTube · capa do canal", width: 2560, height: 1440 },
  { key: "email-header", group: "Banners e capas", label: "Cabeçalho de e-mail", width: 1200, height: 400 },
  { key: "a4", group: "Outros", label: "A4 retrato (150 dpi)", width: 1240, height: 1754 },
];

export const PRESET_GROUPS = ["Instagram", "Carrossel", "Anúncios", "Banners e capas", "Outros"] as const;

export function findPreset(key: string | null | undefined) {
  return key ? FORMAT_PRESETS.find((p) => p.key === key) : undefined;
}
