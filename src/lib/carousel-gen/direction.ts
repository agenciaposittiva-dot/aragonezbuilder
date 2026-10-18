import { MOTIFS, type GeneratorDirection, type Motif } from "@/lib/design-doc/generator";
import { contrast, isDark, luminance, mix, normalizeHex, readable, saturation, shade } from "./color";
import { hasWord, normalizeText } from "./icons";

/*
 * Direção de arte: paleta, tipografia, motivo de continuidade e cantos. Com a
 * identidade do cliente, as cores e fontes vêm do perfil da marca; sem ela,
 * uma paleta curada pelo assunto (sempre marcada como sugestão revisável).
 * A semente muda estilo, motivo e composições — temas diferentes geram
 * carrosséis diferentes, e o mesmo carrossel mantém a unidade.
 */

export type Palette = GeneratorDirection["palette"];

type Style = {
  key: string;
  name: string;
  heading: string;
  body: string;
  weight: number;
  uppercase: boolean;
  radius: number;
};

export const STYLES: Style[] = [
  {
    key: "bold",
    name: "Bold geométrico",
    heading: "Montserrat",
    body: "Inter",
    weight: 800,
    uppercase: false,
    radius: 28,
  },
  {
    key: "editorial",
    name: "Editorial",
    heading: "DM Serif Display",
    body: "DM Sans",
    weight: 400,
    uppercase: false,
    radius: 8,
  },
  {
    key: "condensed",
    name: "Manchete condensada",
    heading: "Oswald",
    body: "Inter",
    weight: 700,
    uppercase: true,
    radius: 0,
  },
  {
    key: "grotesk",
    name: "Grotesca moderna",
    heading: "Space Grotesk",
    body: "Manrope",
    weight: 700,
    uppercase: false,
    radius: 40,
  },
  { key: "friendly", name: "Amigável", heading: "Poppins", body: "Nunito", weight: 700, uppercase: false, radius: 36 },
  {
    key: "impact",
    name: "Impacto",
    heading: "Archivo Black",
    body: "Work Sans",
    weight: 400,
    uppercase: false,
    radius: 16,
  },
];

type CuratedPalette = { key: string; name: string; palette: Palette; tags: string[] };

const P = (
  key: string,
  name: string,
  tags: string[],
  bg: string,
  bgAlt: string,
  surface: string,
  ink: string,
  muted: string,
  accent: string,
  accent2: string,
  onAccent: string,
): CuratedPalette => ({ key, name, tags, palette: { bg, bgAlt, surface, ink, muted, accent, accent2, onAccent } });

export const PALETTES: CuratedPalette[] = [
  P(
    "noite",
    "Noite elétrica",
    ["tech"],
    "#0F1226",
    "#151A36",
    "#1F2550",
    "#F5F7FF",
    "#B9C1EA",
    "#7CF2C8",
    "#8B85FF",
    "#0F1226",
  ),
  P(
    "papel",
    "Papel editorial",
    ["default", "business"],
    "#F6F1E9",
    "#EFE7DA",
    "#FFFFFF",
    "#1E1B16",
    "#5A5146",
    "#C2410C",
    "#1E1B16",
    "#FFFFFF",
  ),
  P(
    "menta",
    "Menta clínica",
    ["health"],
    "#EEF7F5",
    "#E1F1EC",
    "#FFFFFF",
    "#0E3B36",
    "#3D615D",
    "#0F8C77",
    "#0E3B36",
    "#FFFFFF",
  ),
  P(
    "confianca",
    "Azul confiança",
    ["finance", "business"],
    "#0B2545",
    "#102D52",
    "#1C3F6E",
    "#FFFFFF",
    "#C9D6EA",
    "#F2C14E",
    "#8DB3E2",
    "#0B2545",
  ),
  P(
    "terracota",
    "Terracota",
    ["food"],
    "#FFF4EC",
    "#FCE9DC",
    "#FFFFFF",
    "#3B1F14",
    "#6A4537",
    "#B9452F",
    "#E0782A",
    "#FFFFFF",
  ),
  P(
    "lima",
    "Lima energia",
    ["fitness", "tech"],
    "#111111",
    "#181818",
    "#242424",
    "#FFFFFF",
    "#C4C4C4",
    "#C6F432",
    "#FF6B4A",
    "#111111",
  ),
  P(
    "lavanda",
    "Lavanda suave",
    ["beauty", "health"],
    "#F7F0FA",
    "#F0E4F6",
    "#FFFFFF",
    "#3A1F4A",
    "#634C70",
    "#A53D70",
    "#7B4BA3",
    "#FFFFFF",
  ),
  P(
    "pop",
    "Amarelo pop",
    ["education", "marketing"],
    "#FFD84D",
    "#FFE27A",
    "#FFFFFF",
    "#1A1A1A",
    "#3D3D3D",
    "#1A1A1A",
    "#D9480F",
    "#FFD84D",
  ),
  P(
    "natureza",
    "Verde natureza",
    ["nature", "food"],
    "#F1F5EC",
    "#E6EEDD",
    "#FFFFFF",
    "#1F3324",
    "#4A5E4D",
    "#3B7543",
    "#A97C12",
    "#FFFFFF",
  ),
  P(
    "cobalto",
    "Cobalto",
    ["education", "marketing", "business"],
    "#F3F5FF",
    "#E7EBFF",
    "#FFFFFF",
    "#141A3C",
    "#454B6E",
    "#2F49D1",
    "#FF7A45",
    "#FFFFFF",
  ),
];

const TAG_WORDS: [string, string[]][] = [
  [
    "health",
    [
      "saude",
      "clinica",
      "medic",
      "odonto",
      "dente",
      "dental",
      "clareamento",
      "terapia",
      "nutri",
      "hospital",
      "psico",
      "fisio",
      "bem-estar",
    ],
  ],
  ["finance", ["financ", "dinheiro", "invest", "banco", "credito", "contab", "imposto", "economia", "orcamento"]],
  ["food", ["cafe", "restaurante", "comida", "receita", "gastronomia", "padaria", "doce", "cozinha", "pizza"]],
  ["fitness", ["academia", "treino", "fitness", "esporte", "corrida", "musculacao", "crossfit", "atleta"]],
  ["beauty", ["beleza", "estetica", "pele", "cabelo", "maquiagem", "salao", "skincare", "unha"]],
  ["tech", ["tecnologia", "software", "app", "inteligencia artificial", "dados", "digital", "startup", "programa"]],
  ["education", ["educacao", "curso", "escola", "aula", "estudo", "faculdade", "enem", "aprendizado"]],
  ["marketing", ["marketing", "instagram", "redes sociais", "venda", "marca", "conteudo", "anuncio"]],
  ["nature", ["sustentab", "natureza", "planta", "jardim", "organico", "reciclagem", "ambiental"]],
];

export function topicTags(text: string): string[] {
  const t = normalizeText(text);
  return TAG_WORDS.filter(([, words]) => words.some((w) => hasWord(t, w))).map(([tag]) => tag);
}

/** Hash estável (FNV-1a) para a semente. */
export function hashSeed(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2_147_483_647;
}

/** Número pseudoaleatório determinístico a partir da semente (0 ≤ x < 1). */
export function rand(seed: number, salt: number) {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4_294_967_296;
}
export const pick = <T>(list: readonly T[], seed: number, salt: number): T =>
  list[Math.floor(rand(seed, salt) * list.length)]!;

export type BrandIdentity = {
  name: string;
  colors: string[];
  fonts: string[];
  handle?: string;
  logo?: GeneratorDirection["logo"];
};

/** Garante legibilidade de todos os textos da paleta sobre os fundos usados. */
export function fixPalette(p: Palette): Palette {
  const bg = p.bg;
  const tint = mix(bg, p.accent, 0.16);
  const worst = (c: string) => Math.min(contrast(c, bg), contrast(c, p.bgAlt), contrast(c, tint));
  let ink = p.ink;
  if (worst(ink) < 7) ink = pickBest([ink, isDark(bg) ? "#FFFFFF" : "#111111"], worst);
  let muted = p.muted;
  if (worst(muted) < 4.5) {
    for (let t = 0.1; t <= 1.0001 && worst(muted) < 4.5; t += 0.1) muted = mix(p.muted, ink, t);
  }
  // Destaque: usado em números grandes e formas (texto grande pede 3:1).
  let accent = p.accent;
  if (Math.min(contrast(accent, bg), contrast(accent, p.bgAlt)) < 3) {
    const target = isDark(bg) ? "#FFFFFF" : "#000000";
    for (let t = 0.1; t <= 1.0001 && Math.min(contrast(accent, bg), contrast(accent, p.bgAlt)) < 3; t += 0.1)
      accent = mix(p.accent, target, t);
  }
  const onAccent = readable(accent, [p.onAccent, bg, ink, "#FFFFFF", "#111111"], 4.5);
  return { ...p, ink, muted, accent, onAccent, surface: p.surface };
}

function pickBest(list: string[], score: (c: string) => number) {
  return [...list].sort((a, b) => score(b) - score(a))[0]!;
}

/** Paleta a partir das cores da marca (ordem do perfil = importância). */
export function paletteFromBrand(colors: string[], seed: number): { palette: Palette; mode: string } {
  const list = colors.map(normalizeHex).filter((c): c is string => !!c);
  const primary = list[0] ?? "#1E1B16";
  const byLum = [...list].sort((a, b) => luminance(a) - luminance(b));
  const darkest = byLum[0] ?? "#111111";
  const lightest = byLum.at(-1) ?? "#FFFFFF";
  const vivid = [...list].sort((a, b) => saturation(b) - saturation(a))[0] ?? primary;
  const second = list.find((c) => c !== vivid) ?? shade(vivid, -0.35);
  const modes = ["light", "dark", "brand"] as const;
  let mode: (typeof modes)[number] = pick(modes, seed, 11);
  // Cor principal sem contraste com branco nem preto não serve de fundo.
  if (mode === "brand" && Math.max(contrast(primary, "#FFFFFF"), contrast(primary, "#111111")) < 7) mode = "light";
  let bg: string;
  if (mode === "light") bg = luminance(lightest) > 0.85 ? lightest : mix(primary, "#FFFFFF", 0.92);
  else if (mode === "dark") bg = luminance(darkest) < 0.04 ? darkest : mix(primary, "#000000", 0.78);
  else bg = primary;
  const dark = isDark(bg);
  const bgAlt = shade(bg, dark ? 0.05 : -0.035);
  const ink = readable(bg, dark ? [lightest, "#FFFFFF"] : [darkest, "#111111"], 7);
  const accent = mode === "brand" ? (contrast(second, bg) >= 3 ? second : dark ? "#FFFFFF" : "#111111") : vivid;
  return {
    mode,
    palette: fixPalette({
      bg,
      bgAlt,
      surface: dark ? shade(bg, 0.1) : "#FFFFFF",
      ink,
      muted: mix(ink, bg, 0.3),
      accent,
      accent2: second,
      onAccent: dark ? bg : "#FFFFFF",
    }),
  };
}

export function buildDirection(o: {
  seed: number;
  topic: string;
  identity: BrandIdentity | null;
  /** Sugestão da IA (cores e estilo), usada só sem identidade. */
  suggestion?: { style?: string; palette?: string[] } | null;
  exclude?: { style?: string; palette?: string; motif?: Motif };
}): GeneratorDirection {
  const { seed } = o;
  const styles = STYLES.filter((x) => x.key !== o.exclude?.style);
  let style = pick(styles, seed, 1);
  const suggested = o.suggestion?.style ? styles.find((x) => x.key === o.suggestion!.style) : undefined;
  if (suggested && rand(seed, 2) < 0.6) style = suggested;
  const motif = pick(
    MOTIFS.filter((m) => m !== o.exclude?.motif),
    seed,
    3,
  );
  const notes: string[] = [];
  let palette: Palette;
  let name: string;
  let key: string;
  let heading = style.heading;
  let body = style.body;

  if (o.identity) {
    const brand = paletteFromBrand(o.identity.colors, seed);
    palette = brand.palette;
    key = `marca-${brand.mode}-${style.key}`;
    name = `Identidade de ${o.identity.name} · ${style.name}`;
    if (o.identity.colors.length)
      notes.push(`Cores da identidade de ${o.identity.name}: ${o.identity.colors.join(", ")}.`);
    else notes.push(`${o.identity.name} não tem cores cadastradas: paleta neutra (revise no perfil da marca).`);
    if (o.identity.fonts[0]) {
      heading = o.identity.fonts[0];
      body = o.identity.fonts[1] ?? o.identity.fonts[0];
      notes.push(`Fontes da marca: ${[...new Set([heading, body])].join(" e ")}.`);
    }
    if (o.identity.logo) notes.push("Logo do cliente aplicada no rodapé dos slides.");
  } else {
    const tags = topicTags(o.topic);
    const ai = (o.suggestion?.palette ?? []).map(normalizeHex).filter((c): c is string => !!c);
    const pool = PALETTES.filter(
      // Tema mais específico primeiro (a ordem de TAG_WORDS vai do mais ao menos específico).
      (p) => p.key !== o.exclude?.palette && (tags.length ? p.tags.includes(tags[0]!) : true),
    );
    const curated = pick(pool.length ? pool : PALETTES.filter((p) => p.key !== o.exclude?.palette), seed, 4);
    if (ai.length >= 2 && !o.exclude?.palette) {
      palette = paletteFromBrand(ai, seed).palette;
      key = `ia-${style.key}`;
      name = `Sugestão da IA · ${style.name}`;
      notes.push(`Paleta sugerida pela IA (${ai.join(", ")}). Revise antes de aprovar.`);
    } else {
      palette = fixPalette(curated.palette);
      key = `${curated.key}-${style.key}`;
      name = `${curated.name} · ${style.name}`;
      notes.push("Sem identidade de marca: direção visual gerada para o tema. Revise antes de aprovar.");
    }
  }
  return {
    key: key.slice(0, 40),
    name: name.slice(0, 80),
    palette,
    fonts: { heading, body, headingWeight: o.identity?.fonts[0] ? Math.min(style.weight, 800) : style.weight },
    motif,
    radius: style.radius,
    uppercase: style.uppercase,
    seed,
    fromIdentity: !!o.identity,
    logo: o.identity?.logo ?? null,
    handle: (o.identity?.handle || o.identity?.name || "").slice(0, 80),
    notes,
  };
}

/** Cor de fundo das formas de continuidade (mesma em todos os slides). */
export const tintOf = (d: GeneratorDirection) => mix(d.palette.bg, d.palette.accent, 0.16);
