import type { TrendRelated } from "@/server/db/schema";
import { child, childText, children, findAll, parseXml, stripHtml } from "../xml";
import type { CollectedItem, CollectResult, SourceSpec, TrendConnector } from "./types";

/*
 * Google Trends — feed RSS público de buscas em alta por região, oferecido
 * pelo próprio Google Trends (Em alta agora › Exportar › RSS). O único
 * indicador é o "tráfego aproximado" (uma faixa, ex.: "2000+"), exibido
 * exatamente como a fonte informa.
 */

export const GOOGLE_TRENDS_URL = (geo: string) =>
  `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;

const LANG_BY_GEO: Record<string, string> = { BR: "pt", PT: "pt", US: "en", GB: "en", ES: "es", MX: "es", AR: "es" };

export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Lê o feed. Exportada para os testes com respostas gravadas. */
export function parseGoogleTrendsRss(xml: string, spec: Pick<SourceSpec, "config" | "region">): CollectedItem[] {
  const geo = (spec.config.geo ?? spec.region ?? "BR").toUpperCase();
  const doc = parseXml(xml);
  const items = findAll(doc, "item");
  return items
    .map((item, index): CollectedItem | null => {
      const title = stripHtml(childText(item, "title"));
      if (!title) return null;
      const traffic = childText(item, "approx_traffic");
      const pub = childText(item, "pubDate");
      const publishedAt = pub ? new Date(pub) : null;
      const related: TrendRelated[] = children(item, "news_item")
        .map((n) => ({
          title: stripHtml(childText(n, "news_item_title")),
          url: childText(n, "news_item_url") || null,
          source: stripHtml(childText(n, "news_item_source")) || null,
        }))
        .filter((n) => n.title);
      const description = stripHtml(child(item, "description")?.text ?? "");
      return {
        externalId: `${geo}:${slugify(title)}`,
        title,
        summary: description || related[0]?.title || null,
        url: related[0]?.url ?? null,
        platform: "google_trends",
        niche: null,
        region: geo,
        language: LANG_BY_GEO[geo] ?? null,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        eventDate: null,
        rank: index + 1,
        metrics: traffic
          ? [
              {
                key: "approx_traffic",
                label: "Tráfego aproximado de buscas (Google)",
                value: traffic,
                // Faixa informada pelo Google; o número é o limite inferior, nunca um volume exato.
                numeric: Number(traffic.replace(/[^\d]/g, "")) || null,
                asOf:
                  publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString().slice(0, 10) : null,
              },
            ]
          : [],
        related: related.slice(0, 5),
      };
    })
    .filter((x): x is CollectedItem => !!x);
}

export const googleTrendsConnector: TrendConnector = {
  kind: "google_trends",
  info: {
    label: "Google Trends (buscas em alta)",
    endpoint: "https://trends.google.com/trending/rss?geo={REGIÃO}",
    terms:
      "Feed RSS público oferecido pelo próprio Google Trends (Exportar › RSS), sem chave. Uso sujeito aos Termos de Serviço do Google; não é uma API com garantia de disponibilidade.",
    limits:
      "Sem limite documentado. O Radar consulta a cada 6 horas (rotina) e, à mão, no máximo a cada 15 minutos por fonte.",
    cost: "Gratuito.",
    freshness: "Quase em tempo real: buscas em alta nas últimas horas na região escolhida.",
    indicators: "Tráfego aproximado de buscas, na faixa informada pelo Google (ex.: 2000+). Não é volume exato.",
    docs: "https://trends.google.com/trending?geo=BR",
  },
  availability: () => ({ ok: true }),
  async collect(spec, fetchText): Promise<CollectResult> {
    const geo = (spec.config.geo ?? spec.region ?? "BR").toUpperCase();
    const xml = await fetchText(GOOGLE_TRENDS_URL(geo));
    return { items: parseGoogleTrendsRss(xml, spec), dataDate: null };
  },
};
