import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AiModelInfo } from "@/lib/ai-tasks";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { organizations } from "./core";

export const aiUsageStatus = pgEnum("ai_usage_status", ["success", "error", "blocked"]);

/** Registro de uso e custo de cada chamada a provedores de IA. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    clientId: uuid(),
    projectId: uuid(),
    provider: text().notNull(),
    model: text().notNull(),
    operation: text().notNull(),
    /** Módulo de origem (assistant, editor, art…) e tarefa (copy, image_generation…). */
    module: text(),
    task: text(),
    /** Como o modelo foi escolhido: explicit, user_task, org, auto… */
    selectionSource: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    /** Custo informado/estimado em micro-dólares (1e-6 USD); null quando o provedor não dá dados suficientes. */
    costMicros: integer(),
    status: aiUsageStatus().notNull(),
    errorMessage: text(),
    /** Duração da execução. */
    latencyMs: integer(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }),
    index().on(t.organizationId, t.createdAt.desc()),
    index().on(t.organizationId, t.userId, t.createdAt.desc()),
  ],
);

/** Histórico de gerações (conteúdo produzido pelo assistente). */
export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    clientId: uuid(),
    kind: text().notNull(),
    title: text().notNull(),
    input: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    output: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    usageId: uuid().references(() => aiUsage.id, { onDelete: "set null" }),
    pinnedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.createdAt.desc()),
  ],
);

export const aiProviderStatus = pgEnum("ai_provider_status", ["unverified", "valid", "invalid", "error"]);

/**
 * Integração de cada provedor por organização: chave própria (sempre
 * criptografada; sem ela vale a chave do servidor), habilitação, resultado da
 * última validação e modelos descobertos pela API do provedor.
 */
export const aiProviderConfigs = pgTable(
  "ai_provider_configs",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    enabled: boolean().notNull().default(true),
    /** Chave da organização criptografada (src/server/crypto.ts). Nunca vai ao navegador. */
    keyEncrypted: text(),
    status: aiProviderStatus().notNull().default("unverified"),
    lastError: text(),
    lastCheckedAt: tstz(),
    models: jsonb().$type<AiModelInfo[]>().notNull().default([]),
    modelsFetchedAt: tstz(),
    updatedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.provider] })],
);

/**
 * Modelo padrão por organização ou pessoa, opcionalmente por módulo e tarefa.
 * provider/model nulos = escolher automaticamente (com a prioridade indicada).
 */
export const aiModelPreferences = pgTable(
  "ai_model_preferences",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Nulo = preferência da organização. */
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    module: text().notNull().default(""),
    task: text().notNull().default(""),
    provider: text(),
    model: text(),
    priority: text().notNull().default("balanced"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("ai_model_preferences_scope").on(t.organizationId, sql`coalesce(${t.userId}, '')`, t.module, t.task),
  ],
);
