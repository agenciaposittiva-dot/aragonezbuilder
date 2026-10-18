/*
 * Ícones próprios (desenhados para o gerador, sem biblioteca de terceiros):
 * caminhos SVG numa grade 24 × 24 para traço arredondado. Viram objetos
 * `path` editáveis no editor (cor, espessura e tamanho).
 */

const ring = (cx: number, cy: number, r: number) =>
  `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

export const ICONS = {
  check: "M 5 12.5 L 10 17.5 L 19 7",
  x: "M 6 6 L 18 18 M 18 6 L 6 18",
  arrow: "M 4 12 L 20 12 M 14 6 L 20 12 L 14 18",
  alert: "M 12 3.5 L 21.5 20 L 2.5 20 Z M 12 9.5 L 12 14 M 12 17 L 12 17.2",
  bulb: "M 9 18 L 15 18 M 10 21 L 14 21 M 12 3 C 8.1 3 5.5 6 5.5 9.3 C 5.5 11.7 6.8 13.4 8.4 14.6 C 8.9 15 9 15.5 9 16 L 9 18 L 15 18 L 15 16 C 15 15.5 15.1 15 15.6 14.6 C 17.2 13.4 18.5 11.7 18.5 9.3 C 18.5 6 15.9 3 12 3 Z",
  target: `${ring(12, 12, 9)} ${ring(12, 12, 5)} ${ring(12, 12, 1.2)}`,
  chart: "M 4 20 L 20 20 M 7 16.5 L 7 11 M 12 16.5 L 12 6 M 17 16.5 L 17 9",
  trend: "M 3 17 L 9 11 L 13 15 L 21 7 M 15 7 L 21 7 L 21 13",
  heart:
    "M 12 20 C 12 20 3.5 14.8 3.5 8.9 C 3.5 6.2 5.6 4 8.2 4 C 9.8 4 11.2 4.8 12 6.1 C 12.8 4.8 14.2 4 15.8 4 C 18.4 4 20.5 6.2 20.5 8.9 C 20.5 14.8 12 20 12 20 Z",
  shield:
    "M 12 3 L 20 6 L 20 11.5 C 20 16.2 16.6 19.9 12 21 C 7.4 19.9 4 16.2 4 11.5 L 4 6 Z M 8.5 12 L 11 14.5 L 15.5 9.5",
  clock: `${ring(12, 12, 9)} M 12 7 L 12 12 L 15.5 14`,
  users:
    "M 9 4 A 3.5 3.5 0 1 0 9 11 A 3.5 3.5 0 1 0 9 4 Z M 2.5 20 C 2.5 16.4 5.4 14 9 14 C 12.6 14 15.5 16.4 15.5 20 M 16 4.3 A 3.4 3.4 0 0 1 16 11 M 18 14.3 C 20.1 15 21.5 17.2 21.5 20",
  leaf: "M 5 19 C 5 10 10.5 4.5 20 4 C 19.5 13.5 14 19 5 19 Z M 5 19 L 13 11",
  dumbbell: "M 6.5 6.5 L 6.5 17.5 M 17.5 6.5 L 17.5 17.5 M 3.5 9 L 3.5 15 M 20.5 9 L 20.5 15 M 6.5 12 L 17.5 12",
  tooth:
    "M 8 3.5 C 5.5 3.5 4 5.5 4 8 C 4 10.5 5.2 12 5.8 14.5 C 6.4 17 6.7 20.5 8.3 20.5 C 9.9 20.5 10 15.5 12 15.5 C 14 15.5 14.1 20.5 15.7 20.5 C 17.3 20.5 17.6 17 18.2 14.5 C 18.8 12 20 10.5 20 8 C 20 5.5 18.5 3.5 16 3.5 C 14.3 3.5 13.3 4.4 12 4.4 C 10.7 4.4 9.7 3.5 8 3.5 Z",
  coffee:
    "M 4 9 L 16 9 L 16 14 C 16 17.3 13.3 20 10 20 C 6.7 20 4 17.3 4 14 Z M 16 10.5 L 18 10.5 C 19.4 10.5 20.5 11.6 20.5 13 C 20.5 14.4 19.4 15.5 18 15.5 L 16 15.5 M 8 3 C 7 4.2 9 5 8 6.5 M 12 3 C 11 4.2 13 5 12 6.5",
  coin: `${ring(12, 12, 9)} M 12 6.5 L 12 17.5 M 15 9.5 C 15 8.4 13.7 7.8 12 7.8 C 10.3 7.8 9 8.5 9 9.8 C 9 12.6 15 11.4 15 14.2 C 15 15.5 13.7 16.2 12 16.2 C 10.3 16.2 9 15.6 9 14.5`,
  book: "M 4 5 C 6.5 4 9.5 4 12 5.5 C 14.5 4 17.5 4 20 5 L 20 19 C 17.5 18 14.5 18 12 19.5 C 9.5 18 6.5 18 4 19 Z M 12 5.5 L 12 19.5",
  graduation:
    "M 2.5 9 L 12 4.5 L 21.5 9 L 12 13.5 Z M 6.5 11 L 6.5 16 C 8 17.6 10 18.3 12 18.3 C 14 18.3 16 17.6 17.5 16 L 17.5 11 M 21.5 9 L 21.5 14",
  rocket:
    "M 12 2.5 C 15.5 5 17 8.5 17 12.5 L 15 16.5 L 9 16.5 L 7 12.5 C 7 8.5 8.5 5 12 2.5 Z M 12 8.4 A 1.8 1.8 0 1 0 12 12 A 1.8 1.8 0 1 0 12 8.4 Z M 10 19 L 12 21.5 L 14 19 M 7 12.5 L 4.5 15.5 L 4.5 18 L 8.2 16.5 M 17 12.5 L 19.5 15.5 L 19.5 18 L 15.8 16.5",
  star: "M 12 3 L 14.7 8.6 L 20.8 9.3 L 16.3 13.5 L 17.5 19.6 L 12 16.6 L 6.5 19.6 L 7.7 13.5 L 3.2 9.3 L 9.3 8.6 Z",
  home: "M 3.5 11 L 12 4 L 20.5 11 M 6 9.5 L 6 20 L 18 20 L 18 9.5 M 10 20 L 10 14 L 14 14 L 14 20",
  phone: "M 7 2.5 L 17 2.5 L 17 21.5 L 7 21.5 Z M 11 18.5 L 13 18.5",
  calendar: "M 4 6 L 20 6 L 20 20 L 4 20 Z M 4 10 L 20 10 M 8 3.5 L 8 7.5 M 16 3.5 L 16 7.5",
  sparkle:
    "M 12 3 C 12.6 8 14 9.4 19 10 C 14 10.6 12.6 12 12 17 C 11.4 12 10 10.6 5 10 C 10 9.4 11.4 8 12 3 Z M 18.5 15.5 C 18.8 17.6 19.4 18.2 21.5 18.5 C 19.4 18.8 18.8 19.4 18.5 21.5 C 18.2 19.4 17.6 18.8 15.5 18.5 C 17.6 18.2 18.2 17.6 18.5 15.5 Z",
  pin: "M 12 21 C 12 21 5 14.5 5 9.5 C 5 5.6 8.1 2.8 12 2.8 C 15.9 2.8 19 5.6 19 9.5 C 19 14.5 12 21 12 21 Z M 12 7 A 2.5 2.5 0 1 0 12 12 A 2.5 2.5 0 1 0 12 7 Z",
  question: `${ring(12, 12, 9)} M 9.5 9.3 C 9.5 7.9 10.6 6.8 12 6.8 C 13.4 6.8 14.5 7.9 14.5 9.3 C 14.5 11.4 12 11.5 12 13.6 M 12 16.8 L 12 17`,
  drop: "M 12 3 C 12 3 5.5 10 5.5 14.5 C 5.5 18.1 8.4 21 12 21 C 15.6 21 18.5 18.1 18.5 14.5 C 18.5 10 12 3 12 3 Z",
  sun: `${ring(12, 12, 4)} M 12 2.5 L 12 4.5 M 12 19.5 L 12 21.5 M 2.5 12 L 4.5 12 M 19.5 12 L 21.5 12 M 5.3 5.3 L 6.7 6.7 M 17.3 17.3 L 18.7 18.7 M 5.3 18.7 L 6.7 17.3 M 17.3 6.7 L 18.7 5.3`,
  megaphone: "M 3.5 10 L 3.5 14 L 7 14 L 15 18.5 L 15 5.5 L 7 10 Z M 18 9 C 19.2 9.8 19.2 14.2 18 15 M 7 14 L 8.5 19.5",
  cart: "M 3 4 L 5.5 4 L 8 15.5 L 18.5 15.5 L 20.5 7.5 L 6.5 7.5 M 8.5 19.5 A 1 1 0 1 0 10.5 19.5 A 1 1 0 1 0 8.5 19.5 Z M 16 19.5 A 1 1 0 1 0 18 19.5 A 1 1 0 1 0 16 19.5 Z",
  scale:
    "M 12 4 L 12 20 M 7 20 L 17 20 M 5 7 L 19 7 M 5 7 L 2.5 13 C 3.3 14.5 6.7 14.5 7.5 13 Z M 19 7 L 16.5 13 C 17.3 14.5 20.7 14.5 21.5 13 Z",
  chip: "M 7 7 L 17 7 L 17 17 L 7 17 Z M 10 10 L 14 10 L 14 14 L 10 14 Z M 9 3.5 L 9 7 M 15 3.5 L 15 7 M 9 17 L 9 20.5 M 15 17 L 15 20.5 M 3.5 9 L 7 9 M 3.5 15 L 7 15 M 17 9 L 20.5 9 M 17 15 L 20.5 15",
  bookmark: "M 6 3.5 L 18 3.5 L 18 21 L 12 16.5 L 6 21 Z",
  send: "M 21 3 L 10 14 M 21 3 L 14.5 21 L 10 14 L 3 9.5 Z",
  comment: "M 4 5 L 20 5 L 20 16 L 11 16 L 6.5 20 L 6.5 16 L 4 16 Z",
  plus: "M 12 5 L 12 19 M 5 12 L 19 12",
  quote:
    "M 4.5 18 C 4.5 13 6.2 9 10 6.5 L 11 8.2 C 9 9.6 8.2 11.2 8 13 L 10.5 13 L 10.5 18 Z M 13.5 18 C 13.5 13 15.2 9 19 6.5 L 20 8.2 C 18 9.6 17.2 11.2 17 13 L 19.5 13 L 19.5 18 Z",
} as const;
export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** Palavras do tema → ícone (português; sem acento para comparar). */
const KEYWORDS: [IconName, string[]][] = [
  ["tooth", ["dente", "dental", "odonto", "sorriso", "bucal", "gengiva", "clareamento"]],
  ["coffee", ["cafe", "cafeteria", "barista", "espresso"]],
  ["dumbbell", ["academia", "treino", "fitness", "musculacao", "exercicio", "crossfit"]],
  ["heart", ["saude", "coracao", "bem-estar", "bem estar", "cuidado", "amor", "familia"]],
  ["shield", ["seguranca", "protecao", "seguro", "privacidade", "golpe", "lgpd", "imunidade"]],
  ["coin", ["dinheiro", "financ", "invest", "economia", "preco", "credito", "divida", "renda", "orcamento"]],
  ["graduation", ["educacao", "curso", "faculdade", "estudo", "aula", "escola", "vestibular", "enem"]],
  ["book", ["leitura", "livro", "conhecimento", "guia"]],
  ["chip", ["tecnologia", "inteligencia artificial", " ia ", "software", "digital", "automacao", "dados"]],
  ["phone", ["app", "aplicativo", "celular", "instagram", "rede social", "whatsapp"]],
  ["leaf", ["sustentab", "natureza", "planta", "verde", "organico", "jardim", "vegano"]],
  ["cart", ["compra", "loja", "varejo", "ecommerce", "e-commerce", "mercado", "venda"]],
  ["home", ["imovel", "imoveis", "casa", "apartamento", "decoracao", "reforma"]],
  ["megaphone", ["marketing", "divulgacao", "anuncio", "campanha", "marca"]],
  ["clock", ["tempo", "prazo", "rotina", "produtividade", "horario", "sono"]],
  ["users", ["equipe", "pessoas", "comunidade", "clientes", "time", "lideranca"]],
  ["pin", ["viagem", "turismo", "local", "endereco", "cidade", "bairro"]],
  ["sparkle", ["beleza", "estetica", "pele", "skincare", "cabelo", "maquiagem"]],
  ["drop", ["agua", "hidratacao", "chuva", "limpeza"]],
  ["sun", ["verao", "sol", "energia solar", "ferias"]],
  ["scale", ["juridico", "direito", "advoca", "lei", "contrato"]],
  ["rocket", ["startup", "crescimento", "lancamento", "negocio", "empreend"]],
  ["target", ["meta", "objetivo", "estrategia", "foco"]],
];

export function normalizeText(t: string) {
  return ` ${t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, " ")} `;
}

/** A palavra (ou o começo dela) aparece no texto normalizado — "dados" não casa com "cuidados". */
export const hasWord = (normalized: string, word: string) =>
  word.endsWith(" ") ? normalized.includes(` ${word.trim()} `) : normalized.includes(` ${word.trim()}`);

/** Ícone que combina com o texto (ou null). */
export function iconForText(text: string): IconName | null {
  const t = normalizeText(text);
  for (const [icon, words] of KEYWORDS) if (words.some((w) => hasWord(t, w))) return icon;
  return null;
}

export function isIconName(name: string): name is IconName {
  return (ICON_NAMES as string[]).includes(name);
}
