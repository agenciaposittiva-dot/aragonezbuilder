import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  BioStyle,
  DiagnosisInputs,
  DiagnosisKind,
  DiagnosisResult,
  ManualInputs,
  RecommendationArea,
  RecommendationCategory,
  RecommendationStatus,
} from "@/lib/brand-radar";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { campaigns, contentItems } from "./content";
import { memberships, organizations } from "./core";
import { designs } from "./designs";
import { files } from "./files";
import { tasks } from "./tasks";

/*
 * Radar de Marca: diagnóstico estratégico de perfis do Instagram de cada
 * cliente. Todo dado guarda a fonte e a data (ver src/lib/brand-radar.ts).
 * Nada daqui altera o Instagram: "usar esta bio" grava no cadastro do perfil
 * na plataforma; a conexão oficial (API da Meta) só lê dados autorizados.
 */

/** Perfil analisado: o do próprio cliente (own) ou de um concorrente que ele acompanha. */
export const brandRadarProfiles = pgTable(
  "brand_radar_profiles",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    /** own | competitor */
    kind: text().notNull().default("own"),
    network: text().notNull().default("instagram"),
    handle: text().notNull(),
    profileUrl: text().notNull(),
    /** Nicho, mercado e região de atuação (perfil próprio). */
    niche: text(),
    market: text(),
    region: text(),
    /** Observações da equipe (ex.: sobre o concorrente). */
    notes: text(),
    /** Dados informados manualmente, guardados até a próxima análise. */
    manual: jsonb().$type<ManualInputs>(),
    /** Bio escolhida pela equipe para implementar ("Usar esta versão"); não é a bio atual do Instagram. */
    plannedBio: text(),
    plannedBioAt: tstz(),
    plannedBioByUserId: text().references(() => user.id, { onDelete: "set null" }),
    archivedAt: tstz(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("brand_radar_profiles_handle_unique").on(t.organizationId, t.clientId, t.network, t.handle),
    index().on(t.organizationId, t.clientId),
  ],
);

/** Conexão oficial com a conta profissional (Instagram API com login do Instagram). */
export const brandRadarConnections = pgTable(
  "brand_radar_connections",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: uuid().notNull(),
    igUserId: text().notNull(),
    username: text().notNull(),
    accountType: text(),
    /** Token de acesso de longa duração, sempre criptografado (src/server/crypto.ts). */
    accessTokenEnc: text(),
    tokenExpiresAt: tstz(),
    scopes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** connected | expired | revoked | error */
    status: text().notNull().default("connected"),
    lastSyncAt: tstz(),
    /** Última leitura da API (perfil e publicações), com a data da coleta. */
    lastSync: jsonb().$type<Record<string, unknown>>(),
    lastError: text(),
    connectedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.profileId],
      foreignColumns: [brandRadarProfiles.organizationId, brandRadarProfiles.id],
    }).onDelete("cascade"),
    uniqueIndex("brand_radar_connections_profile_unique").on(t.profileId),
  ],
);

/** Diagnósticos (linha do tempo). Os dados usados e o resultado ficam congelados. */
export const brandRadarDiagnoses = pgTable(
  "brand_radar_diagnoses",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    profileId: uuid().notNull(),
    kind: text().$type<DiagnosisKind>().notNull().default("full"),
    methodologyVersion: text().notNull(),
    weights: jsonb().$type<Record<string, number>>().notNull().default({}),
    inputs: jsonb().$type<DiagnosisInputs>().notNull(),
    result: jsonb().$type<DiagnosisResult | Record<string, unknown>>().notNull(),
    /** Nota 0–100 (só do diagnóstico completo e só com dimensões avaliadas). */
    overallScore: integer(),
    evaluatedWeight: integer(),
    provider: text(),
    model: text(),
    demo: boolean().notNull().default(false),
    generationId: uuid(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.profileId],
      foreignColumns: [brandRadarProfiles.organizationId, brandRadarProfiles.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.profileId, t.createdAt.desc()),
  ],
);

/** Cartões de recomendação (viram tarefa, arte, conteúdo ou campanha). */
export const brandRadarRecommendations = pgTable(
  "brand_radar_recommendations",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    profileId: uuid().notNull(),
    diagnosisId: uuid().notNull(),
    area: text().$type<RecommendationArea>().notNull(),
    category: text().$type<RecommendationCategory>().notNull(),
    title: text().notNull(),
    problem: text().notNull(),
    evidence: text().notNull().default(""),
    evidenceSource: text().notNull().default(""),
    /** observed | hypothesis | insufficient */
    basis: text().notNull().default("hypothesis"),
    impact: text().notNull().default("medio"),
    effort: text().notNull().default("medio"),
    /** 1 (mais urgente) a 5. */
    priority: integer().notNull().default(3),
    confidence: text().notNull().default("medio"),
    nextAction: text().notNull().default(""),
    howToTest: text(),
    assigneeMembershipId: uuid().references(() => memberships.id, { onDelete: "set null" }),
    dueDate: date({ mode: "string" }),
    status: text().$type<RecommendationStatus>().notNull().default("open"),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    designId: uuid().references(() => designs.id, { onDelete: "set null" }),
    contentItemId: uuid().references(() => contentItems.id, { onDelete: "set null" }),
    campaignId: uuid().references(() => campaigns.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.diagnosisId],
      foreignColumns: [brandRadarDiagnoses.organizationId, brandRadarDiagnoses.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.profileId, t.status),
  ],
);

/** Versões de bio salvas, editadas, escolhidas ou enviadas para aprovação. */
export const brandRadarBioVersions = pgTable(
  "brand_radar_bio_versions",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    profileId: uuid().notNull(),
    diagnosisId: uuid(),
    style: text().$type<BioStyle>().notNull(),
    text: text().notNull(),
    objective: text().notNull().default(""),
    strengths: jsonb().$type<string[]>().notNull().default([]),
    cta: text().notNull().default(""),
    warnings: jsonb().$type<string[]>().notNull().default([]),
    /** draft | chosen | sent_for_approval */
    status: text().notNull().default("draft"),
    /** Arquivo de texto criado para a aprovação (fluxo de aprovações existente). */
    fileId: uuid().references(() => files.id, { onDelete: "set null" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.profileId],
      foreignColumns: [brandRadarProfiles.organizationId, brandRadarProfiles.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.profileId),
  ],
);
