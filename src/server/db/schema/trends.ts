import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { organizations } from "./core";

/*
 * Radar de Tendências. Separação deliberada:
 *  - `trends` e `trend_observations` guardam SOMENTE o que a fonte devolveu
 *    (título, link, datas e indicadores exatamente como informados);
 *  - `trend_analyses` guarda as INFERÊNCIAS da IA (tipo, relevância, riscos,
 *    ângulos), sempre com o modelo que as produziu.
 * Nenhuma tabela de inferência tem colunas numéricas de popularidade.
 */

export const trendSourceKind = pgEnum("trend_source_kind", [
  "google_trends",
  "wikimedia",
  "youtube",
  "rss",
  "calendar",
]);

/** Indicador exatamente como a fonte informou (ex.: "Tráfego aproximado: 2.000+"). */
export type TrendMetric = {
  key: string;
  label: string;
  /** Valor exibido, sem arredondar nem reformatar o que a fonte deu. */
  value: string;
  /** Valor numérico quando a fonte dá um número exato (para comparar coletas). */
  numeric?: number | null;
  /** Data de referência do indicador (ex.: dia das visualizações da Wikipédia). */
  asOf?: string | null;
};

export type TrendRelated = { title: string; url: string | null; source: string | null };

export const trendSources = pgTable(
  "trend_sources",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: trendSourceKind().notNull(),
    /** Chave estável por organização (ex.: "google_trends:BR"); impede fontes duplicadas. */
    key: text().notNull(),
    name: text().notNull(),
    /** Parâmetros do conector (região, projeto da Wikipédia, endereço do feed…). Nunca guarda segredos. */
    config: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** Nicho atribuído aos itens desta fonte (feeds especializados). */
    niche: text(),
    region: text(),
    language: text(),
    enabled: boolean().notNull().default(true),
    isDefault: boolean().notNull().default(false),
    /** Trava de execução (evita duas coletas simultâneas da mesma fonte). */
    runningSince: tstz(),
    lastRunAt: tstz(),
    lastSuccessAt: tstz(),
    lastError: text(),
    lastItemCount: integer(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.id), unique("trend_sources_org_key").on(t.organizationId, t.key)],
);

export const trends = pgTable(
  "trends",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid().notNull(),
    /** Identificador do item na fonte (idempotência: a mesma coleta não duplica). */
    externalId: text().notNull(),
    title: text().notNull(),
    summary: text(),
    url: text(),
    /** google_trends | wikipedia | youtube | news | calendar */
    platform: text().notNull(),
    niche: text(),
    region: text(),
    language: text(),
    /** Data de publicação informada pela fonte. */
    publishedAt: tstz(),
    /** Data do evento (datas comemorativas). */
    eventDate: date({ mode: "string" }),
    firstSeenAt: tstz().notNull().defaultNow(),
    lastSeenAt: tstz().notNull().defaultNow(),
    metrics: jsonb().$type<TrendMetric[]>().notNull().default([]),
    related: jsonb().$type<TrendRelated[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("trends_source_external").on(t.organizationId, t.sourceId, t.externalId),
    foreignKey({
      columns: [t.organizationId, t.sourceId],
      foreignColumns: [trendSources.organizationId, trendSources.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.lastSeenAt.desc()),
    index().on(t.organizationId, t.niche),
    index("trends_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

/** Uma linha por tendência e dia: permite mostrar evidência de crescimento entre coletas. */
export const trendObservations = pgTable(
  "trend_observations",
  {
    id: id(),
    organizationId: uuid().notNull(),
    trendId: uuid().notNull(),
    observedOn: date({ mode: "string" }).notNull(),
    observedAt: tstz().notNull().defaultNow(),
    rank: integer(),
    metrics: jsonb().$type<TrendMetric[]>().notNull().default([]),
  },
  (t) => [
    unique("trend_observations_day").on(t.trendId, t.observedOn),
    foreignKey({
      columns: [t.organizationId, t.trendId],
      foreignColumns: [trends.organizationId, trends.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.trendId, t.observedOn.desc()),
  ],
);

/** Inferências da IA. `clientId` nulo = classificação geral; preenchido = adequação à marca. */
export const trendAnalyses = pgTable(
  "trend_analyses",
  {
    id: id(),
    organizationId: uuid().notNull(),
    trendId: uuid().notNull(),
    clientId: uuid(),
    /** classification | client_fit */
    kind: text().notNull(),
    /** emergente | crescimento | recorrente | sazonal */
    trendType: text(),
    relevance: text(),
    velocity: text(),
    nicheFit: text(),
    brandFit: text(),
    audienceInterest: text(),
    saturation: text(),
    reputationRisk: text(),
    sensitivity: text(),
    lifespan: text(),
    confidence: text(),
    /** Nicho sugerido pela IA (quando a fonte não informa). */
    suggestedNiche: text(),
    /** Recomendação para o cliente (adequação à marca). */
    recommended: boolean(),
    angles: jsonb().$type<string[]>().notNull().default([]),
    avoid: jsonb().$type<string[]>().notNull().default([]),
    rationale: text(),
    /** Ajustes aplicados pelas regras do sistema (ex.: número sem respaldo removido). */
    guardrails: jsonb().$type<string[]>().notNull().default([]),
    provider: text().notNull(),
    model: text().notNull(),
    demo: boolean().notNull().default(false),
    generationId: uuid(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.trendId],
      foreignColumns: [trends.organizationId, trends.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.trendId, t.createdAt.desc()),
    index().on(t.organizationId, t.clientId, t.createdAt.desc()),
  ],
);

/** Estado pessoal de cada tendência (salvar, favoritar, acompanhar, descartar). */
export const trendUserStates = pgTable(
  "trend_user_states",
  {
    organizationId: uuid().notNull(),
    trendId: uuid().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    saved: boolean().notNull().default(false),
    favorite: boolean().notNull().default(false),
    following: boolean().notNull().default(false),
    dismissed: boolean().notNull().default(false),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.trendId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.trendId],
      foreignColumns: [trends.organizationId, trends.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.userId),
  ],
);

/** Coleções compartilhadas pela equipe da organização. */
export const trendCollections = pgTable(
  "trend_collections",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.id)],
);

export const trendCollectionItems = pgTable(
  "trend_collection_items",
  {
    organizationId: uuid().notNull(),
    collectionId: uuid().notNull(),
    trendId: uuid().notNull(),
    addedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.trendId] }),
    foreignKey({
      columns: [t.organizationId, t.collectionId],
      foreignColumns: [trendCollections.organizationId, trendCollections.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.trendId],
      foreignColumns: [trends.organizationId, trends.id],
    }).onDelete("cascade"),
  ],
);
