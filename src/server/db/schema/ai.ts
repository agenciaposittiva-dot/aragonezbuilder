import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./_helpers";
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
    provider: text().notNull(),
    model: text().notNull(),
    operation: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    /** Custo informado/estimado em micro-dólares (1e-6 USD). */
    costMicros: integer().notNull().default(0),
    status: aiUsageStatus().notNull(),
    errorMessage: text(),
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
