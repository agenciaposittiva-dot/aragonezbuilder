import { pickEnv } from "@/server/env-names";
import type { TrendMetric } from "@/server/db/schema";
import type { CollectedItem, CollectResult, SourceSpec, TrendConnector } from "./types";
import { ConnectorError } from "./types";

/*
 * YouTube Data API v3 — vídeos em alta por região (chart=mostPopular). Só é
 * consultada com YOUTUBE_API_KEY no servidor. Estatísticas como o YouTube
 * informa (podem faltar quando o canal oculta curtidas).
 */

export const YOUTUBE_URL = (region: string, key: string) =>
  `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&maxResults=25&regionCode=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`;

/** Categoria informada pelo próprio YouTube → nicho do Radar. */
const CATEGORY_NICHE: Record<string, string> = {
  "1": "entretenimento",
  "10": "entretenimento",
  "17": "esportes",
  "19": "turismo",
  "20": "entretenimento",
  "22": "criadores",
  "23": "entretenimento",
  "24": "entretenimento",
  "25": "noticias",
  "26": "criadores",
  "27": "educacao",
  "28": "tecnologia",
};

type YtResponse = {
  items?: {
    id: string;
    snippet?: {
      publishedAt?: string;
      title?: string;
      description?: string;
      channelTitle?: string;
      categoryId?: string;
      defaultAudioLanguage?: string;
      defaultLanguage?: string;
    };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }[];
  error?: { message?: string };
};

export function youtubeKey(): string | null {
  return pickEnv("YOUTUBE_API_KEY") ?? null;
}

export function parseYoutubePopular(
  body: string,
  spec: Pick<SourceSpec, "config" | "region">,
  fetchedAt: Date,
): CollectResult {
  let data: YtResponse;
  try {
    data = JSON.parse(body) as YtResponse;
  } catch {
    throw new ConnectorError("Resposta do YouTube fora do formato esperado.");
  }
  if (data.error) throw new ConnectorError(`YouTube: ${data.error.message ?? "erro"}`);
  const region = (spec.config.region ?? spec.region ?? "BR").toUpperCase();
  const asOf = fetchedAt.toISOString().slice(0, 10);
  const stat = (key: string, label: string, raw?: string): TrendMetric | null =>
    raw && /^\d+$/.test(raw)
      ? { key, label, value: Number(raw).toLocaleString("pt-BR"), numeric: Number(raw), asOf }
      : null;
  const items: CollectedItem[] = (data.items ?? []).map((v, i) => {
    const sn = v.snippet ?? {};
    const lang = (sn.defaultAudioLanguage ?? sn.defaultLanguage ?? "").split("-")[0] || null;
    return {
      externalId: v.id,
      title: sn.title?.trim() || v.id,
      summary: sn.description ? sn.description.replace(/\s+/g, " ").trim().slice(0, 400) : null,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,
      platform: "youtube",
      niche: sn.categoryId ? (CATEGORY_NICHE[sn.categoryId] ?? null) : null,
      region,
      language: lang,
      publishedAt: sn.publishedAt ? new Date(sn.publishedAt) : null,
      eventDate: null,
      rank: i + 1,
      metrics: [
        stat("views", "Visualizações no YouTube", v.statistics?.viewCount),
        stat("likes", "Curtidas no YouTube", v.statistics?.likeCount),
        stat("comments", "Comentários no YouTube", v.statistics?.commentCount),
      ].filter((m): m is TrendMetric => !!m),
      related: sn.channelTitle ? [{ title: `Canal: ${sn.channelTitle}`, url: null, source: "YouTube" }] : [],
    };
  });
  return { items, dataDate: asOf };
}

export const youtubeConnector: TrendConnector = {
  kind: "youtube",
  info: {
    label: "YouTube (vídeos em alta)",
    endpoint:
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode={REGIÃO}",
    terms:
      "API oficial (YouTube API Services Terms of Service e Developer Policies). Requer chave de API do Google Cloud em YOUTUBE_API_KEY, guardada só no servidor.",
    limits: "Cota padrão de 10.000 unidades por dia por projeto; cada consulta custa 1 unidade.",
    cost: "Gratuito dentro da cota.",
    freshness: "Lista atualizada pelo YouTube ao longo do dia; estatísticas no momento da coleta.",
    indicators: "Visualizações, curtidas e comentários informados pelo YouTube (quando o canal não oculta).",
    docs: "https://developers.google.com/youtube/v3/docs/videos/list",
  },
  availability: () =>
    youtubeKey() ? { ok: true } : { ok: false, reason: "Defina YOUTUBE_API_KEY no servidor para ativar esta fonte." },
  async collect(spec, fetchText, now): Promise<CollectResult> {
    const key = youtubeKey();
    if (!key) throw new ConnectorError("YOUTUBE_API_KEY não configurada.");
    const region = (spec.config.region ?? spec.region ?? "BR").toUpperCase();
    return parseYoutubePopular(await fetchText(YOUTUBE_URL(region, key)), spec, now);
  },
};
