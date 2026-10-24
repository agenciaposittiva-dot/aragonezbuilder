/*
 * Categorias da galeria de modelos do Estúdio Criador. O nome fica gravado em
 * `designs.template_category` (texto livre, até 60 caracteres): categorias
 * antigas continuam válidas e são exibidas no grupo equivalente.
 */

export const TEMPLATE_CATEGORIES = [
  "Aesthetic",
  "Minimalista",
  "Editorial",
  "Comercial",
  "Institucional",
  "Educacional",
  "Promocional",
  "Autoridade e posicionamento",
  "Storytelling",
  "Carrosséis estratégicos",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const OTHER_CATEGORY = "Outros modelos";

/** Categorias usadas antes da galeria por categoria (modelos já adicionados). */
const LEGACY: Record<string, TemplateCategory> = {
  capas: "Autoridade e posicionamento",
  frases: "Minimalista",
  serviços: "Comercial",
  servicos: "Comercial",
  carrosséis: "Carrosséis estratégicos",
  carrosseis: "Carrosséis estratégicos",
};

/** Grupo de exibição de uma categoria gravada (nova, antiga ou vazia). */
export function categoryGroup(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) return OTHER_CATEGORY;
  const known = TEMPLATE_CATEGORIES.find((c) => c.localeCompare(value, "pt-BR", { sensitivity: "base" }) === 0);
  if (known) return known;
  return LEGACY[value.toLowerCase()] ?? value;
}

/** Ordem das seções: categorias conhecidas primeiro, depois as demais por nome, "Outros" por último. */
export function compareCategories(a: string, b: string) {
  const ia = (TEMPLATE_CATEGORIES as readonly string[]).indexOf(a);
  const ib = (TEMPLATE_CATEGORIES as readonly string[]).indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  if (a === OTHER_CATEGORY) return 1;
  if (b === OTHER_CATEGORY) return -1;
  return a.localeCompare(b, "pt-BR");
}

export const FORMAT_FILTERS = [
  { key: "4:5", label: "Post 4:5" },
  { key: "1:1", label: "Quadrado 1:1" },
  { key: "9:16", label: "Vertical 9:16" },
  { key: "16:9", label: "Paisagem 16:9" },
  { key: "outro", label: "Outros formatos" },
] as const;

export type FormatKey = (typeof FORMAT_FILTERS)[number]["key"];

/** Proporção reconhecida de uma arte (tolerância de 2%). */
export function formatKey(width: number, height: number): FormatKey {
  const r = width / height;
  const near = (v: number) => Math.abs(r - v) / v < 0.02;
  if (near(4 / 5)) return "4:5";
  if (near(1)) return "1:1";
  if (near(9 / 16)) return "9:16";
  if (near(16 / 9)) return "16:9";
  return "outro";
}

/** Rótulo curto do formato: "4:5", "9:16" ou as medidas quando não é uma proporção comum. */
export function formatLabel(width: number, height: number) {
  const key = formatKey(width, height);
  return key === "outro" ? `${width}×${height}` : key;
}
