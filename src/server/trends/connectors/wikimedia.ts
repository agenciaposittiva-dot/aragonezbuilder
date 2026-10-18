import type { CollectedItem, CollectResult, SourceSpec, TrendConnector } from "./types";
import { ConnectorError } from "./types";

/*
 * Wikimedia REST API — artigos mais vistos de um projeto (ex.: pt.wikipedia)
 * em um dia. As contagens são reais e se referem ao dia informado (os dados
 * ficam disponíveis com cerca de um dia de atraso).
 */

export const WIKIMEDIA_TOP_URL = (project: string, date: string) => {
  const [y, m, d] = date.split("-");
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${encodeURIComponent(project)}/all-access/${y}/${m}/${d}`;
};

/** Páginas de navegação e de serviço que não são assuntos. */
const SKIP_PREFIXES = [
  "Especial:",
  "Wikipédia:",
  "Ficheiro:",
  "Arquivo:",
  "Ajuda:",
  "Portal:",
  "Categoria:",
  "Predefinição:",
  "Usuário(a):",
  "Utilizador:",
  "Special:",
  "Wikipedia:",
  "File:",
  "Help:",
  "Category:",
  "Template:",
  "User:",
  "Main_Page",
  "Página_principal",
  "Wikipédia:Página_principal",
];

const LANG_BY_PROJECT = (project: string) => project.split(".")[0] ?? null;
const REGION_BY_LANG: Record<string, string> = { pt: "BR", en: "US", es: "ES" };

type WikiTop = {
  items?: {
    project: string;
    year: string;
    month: string;
    day: string;
    articles: { article: string; views: number; rank: number }[];
  }[];
};

export function parseWikimediaTop(body: string, spec: Pick<SourceSpec, "config">, limit = 25): CollectResult {
  let data: WikiTop;
  try {
    data = JSON.parse(body) as WikiTop;
  } catch {
    throw new ConnectorError("Resposta da Wikimedia fora do formato esperado.");
  }
  const day = data.items?.[0];
  if (!day) return { items: [], dataDate: null };
  const project = spec.config.project ?? day.project ?? "pt.wikipedia";
  const dataDate = `${day.year}-${day.month}-${day.day}`;
  const lang = LANG_BY_PROJECT(project);
  const items: CollectedItem[] = day.articles
    .filter((a) => a.article && a.article !== "-" && !SKIP_PREFIXES.some((p) => a.article.startsWith(p)))
    .slice(0, limit)
    .map((a) => ({
      externalId: a.article,
      title: a.article.replace(/_/g, " "),
      summary: null,
      url: `https://${project}.org/wiki/${encodeURIComponent(a.article)}`,
      platform: "wikipedia",
      niche: null,
      region: lang ? (REGION_BY_LANG[lang] ?? null) : null,
      language: lang,
      publishedAt: null,
      eventDate: null,
      rank: a.rank,
      metrics: [
        {
          key: "pageviews",
          label: "Visualizações na Wikipédia no dia",
          value: a.views.toLocaleString("pt-BR"),
          numeric: a.views,
          asOf: dataDate,
        },
        {
          key: "rank",
          label: "Posição entre os mais vistos do dia",
          value: `${a.rank}º`,
          numeric: a.rank,
          asOf: dataDate,
        },
      ],
      related: [],
    }));
  return { items, dataDate };
}

function isoDay(d: Date, minusDays: number) {
  const x = new Date(d.getTime() - minusDays * 86_400_000);
  return x.toISOString().slice(0, 10);
}

export const wikimediaConnector: TrendConnector = {
  kind: "wikimedia",
  info: {
    label: "Wikipédia (mais vistos do dia)",
    endpoint: "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/{projeto}/all-access/{AAAA}/{MM}/{DD}",
    terms:
      "API pública da Wikimedia Foundation (dados de visualizações em domínio público, CC0). Exige um User-Agent identificável, que o Radar envia.",
    limits:
      "Política da Wikimedia REST: até 100 requisições por segundo. O Radar faz 1 a 2 requisições por coleta (a cada 6 horas, ou à mão a cada 15 minutos no máximo).",
    cost: "Gratuito.",
    freshness: "Dados do dia anterior (atraso de cerca de 1 dia). A data de referência aparece em cada indicador.",
    indicators: "Visualizações reais do artigo no dia e posição no ranking do projeto.",
    docs: "https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html",
  },
  availability: () => ({ ok: true }),
  async collect(spec, fetchText, now): Promise<CollectResult> {
    const project = spec.config.project ?? "pt.wikipedia";
    // O dia anterior pode ainda não estar publicado: tenta ontem e, se faltar, anteontem.
    let lastError: unknown = null;
    for (const back of [1, 2]) {
      try {
        const body = await fetchText(WIKIMEDIA_TOP_URL(project, isoDay(now, back)));
        return parseWikimediaTop(body, { config: { ...spec.config, project } });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new ConnectorError("Wikimedia indisponível.");
  },
};
