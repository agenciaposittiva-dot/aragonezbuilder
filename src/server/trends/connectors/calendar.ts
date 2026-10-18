import { upcomingBrDates } from "../br-dates";
import type { CollectResult, TrendConnector } from "./types";

/* Datas comemorativas brasileiras (fonte sazonal calculada localmente, sem rede). */
export const calendarConnector: TrendConnector = {
  kind: "calendar",
  info: {
    label: "Datas comemorativas do Brasil",
    endpoint: "Calculado no servidor (src/server/trends/br-dates.ts).",
    terms:
      "Dados públicos: leis federais de feriados, datas de organismos internacionais e datas consagradas pelo varejo. A fonte de cada data aparece no item.",
    limits: "Sem limite (não usa rede).",
    cost: "Gratuito.",
    freshness: "Próximos 60 dias, recalculado a cada coleta.",
    indicators: "Nenhum indicador de audiência: são datas do calendário.",
    docs: "https://www.planalto.gov.br/ccivil_03/leis/2002/l10607.htm",
  },
  availability: () => ({ ok: true }),
  async collect(spec, _fetch, now): Promise<CollectResult> {
    const days = Number(spec.config.days ?? 60) || 60;
    const items = upcomingBrDates(now, days).map((d) => ({
      externalId: `${d.slug}:${d.date}`,
      title: d.name,
      summary: `${d.description} Fonte: ${d.source}.${d.sensitive ? " Tema sensível: trate com cuidado." : ""}`,
      url: d.url,
      platform: "calendar" as const,
      niche: d.niche,
      region: "BR",
      language: "pt",
      publishedAt: null,
      eventDate: d.date,
      rank: null,
      metrics: [],
      related: [],
    }));
    return { items, dataDate: null };
  },
};
