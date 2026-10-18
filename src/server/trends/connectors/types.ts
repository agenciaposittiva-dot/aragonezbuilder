import type { TrendPlatform } from "@/lib/trends";
import type { TrendMetric, TrendRelated } from "@/server/db/schema";

export type TrendSourceKind = "google_trends" | "wikimedia" | "youtube" | "rss" | "calendar";

/** O que o conector precisa saber da fonte (nunca segredos: chaves vêm do ambiente do servidor). */
export type SourceSpec = {
  kind: TrendSourceKind;
  config: Record<string, string>;
  region: string | null;
  language: string | null;
  niche: string | null;
};

/** Um item exatamente como a fonte o descreveu. */
export type CollectedItem = {
  externalId: string;
  title: string;
  summary: string | null;
  url: string | null;
  platform: TrendPlatform;
  niche: string | null;
  region: string | null;
  language: string | null;
  publishedAt: Date | null;
  eventDate: string | null;
  rank: number | null;
  metrics: TrendMetric[];
  related: TrendRelated[];
};

export type CollectResult = {
  items: CollectedItem[];
  /** Data de referência dos dados (ex.: dia das visualizações da Wikipédia). */
  dataDate: string | null;
};

/** Documentação mostrada na tela de fontes e no plano (docs/TRENDS-PLAN.md). */
export type ConnectorInfo = {
  label: string;
  endpoint: string;
  terms: string;
  limits: string;
  cost: string;
  freshness: string;
  indicators: string;
  docs: string;
};

export type FetchText = (url: string, init?: { headers?: Record<string, string> }) => Promise<string>;

export interface TrendConnector {
  kind: TrendSourceKind;
  info: ConnectorInfo;
  /** Pré-requisitos (ex.: chave da API). Fonte indisponível não é consultada. */
  availability(): { ok: true } | { ok: false; reason: string };
  collect(spec: SourceSpec, fetchText: FetchText, now: Date): Promise<CollectResult>;
}

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}
