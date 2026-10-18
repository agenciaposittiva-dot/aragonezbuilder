import { z } from "zod";

/*
 * Vocabulário do Radar de Tendências (compartilhado entre servidor e
 * interface). Nichos personalizados são texto livre normalizado; os nichos
 * abaixo são os padrão da plataforma.
 */

export const TREND_NICHES = {
  marketing: "Marketing e publicidade",
  design: "Design e criatividade",
  negocios: "Empreendedorismo e negócios",
  tecnologia: "Tecnologia e inteligência artificial",
  moda: "Moda e beleza",
  saude: "Saúde e bem-estar",
  alimentacao: "Alimentação, gastronomia e restaurantes",
  varejo: "Varejo e comércio local",
  educacao: "Educação",
  imobiliario: "Imobiliário e arquitetura",
  turismo: "Turismo e viagens",
  esportes: "Esportes",
  entretenimento: "Entretenimento e cultura pop",
  criadores: "Criadores de conteúdo",
  datas: "Datas comemorativas",
  noticias: "Notícias e acontecimentos",
  outros: "Outros",
} as const;
export type TrendNiche = keyof typeof TREND_NICHES;

export function nicheLabel(niche: string | null | undefined): string {
  if (!niche) return "Sem nicho";
  return (TREND_NICHES as Record<string, string>)[niche] ?? niche;
}

/** Nicho personalizado: texto curto, minúsculo e sem espaços duplicados. */
export function normalizeNiche(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
}

export const TREND_PLATFORMS = {
  google_trends: "Google Trends",
  wikipedia: "Wikipédia",
  youtube: "YouTube",
  news: "Notícias / RSS",
  calendar: "Datas comemorativas",
} as const;
export type TrendPlatform = keyof typeof TREND_PLATFORMS;

/** Tipos de oportunidade (inferência da IA ou regra do sistema para datas). */
export const TREND_TYPES = {
  emergente: "Emergente",
  crescimento: "Em crescimento",
  recorrente: "Recorrente",
  sazonal: "Sazonal",
} as const;
export type TrendType = keyof typeof TREND_TYPES;

export const LEVELS = { baixa: "Baixa", media: "Média", alta: "Alta" } as const;
export type Level = keyof typeof LEVELS;

export const RISK_LEVELS = { baixo: "Baixo", medio: "Médio", alto: "Alto" } as const;
export type RiskLevel = keyof typeof RISK_LEVELS;

export const LIFESPANS = {
  horas: "Horas",
  dias: "Dias",
  semanas: "Semanas",
  meses: "Meses",
  recorrente: "Recorrente (volta todo ano)",
} as const;
export type Lifespan = keyof typeof LIFESPANS;

export const TREND_PERIODS = {
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  proximos: "Próximas datas (60 dias)",
} as const;
export type TrendPeriod = keyof typeof TREND_PERIODS;

export const TREND_TABS = {
  all: "Todas",
  saved: "Salvas",
  favorite: "Favoritas",
  following: "Acompanhando",
  dismissed: "Descartadas",
} as const;
export type TrendTab = keyof typeof TREND_TABS;

export const trendListParams = z.object({
  q: z.string().trim().max(120).optional(),
  niche: z.string().trim().max(60).optional(),
  region: z.string().trim().max(10).optional(),
  language: z.string().trim().max(10).optional(),
  platform: z.enum(Object.keys(TREND_PLATFORMS) as [TrendPlatform, ...TrendPlatform[]]).optional(),
  type: z.enum(Object.keys(TREND_TYPES) as [TrendType, ...TrendType[]]).optional(),
  period: z.enum(Object.keys(TREND_PERIODS) as [TrendPeriod, ...TrendPeriod[]]).default("7d"),
  tab: z.enum(Object.keys(TREND_TABS) as [TrendTab, ...TrendTab[]]).default("all"),
  collectionId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(6).max(60).default(24),
});
export type TrendListParams = z.input<typeof trendListParams>;

/** Regiões e idiomas oferecidos nos filtros e nas fontes padrão. */
export const TREND_REGIONS = { BR: "Brasil", PT: "Portugal", US: "Estados Unidos" } as const;
export const TREND_LANGUAGES = { pt: "Português", en: "Inglês", es: "Espanhol" } as const;
