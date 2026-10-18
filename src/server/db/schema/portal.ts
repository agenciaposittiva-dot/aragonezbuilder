import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
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
 * Personalização do portal de cada cliente. As configurações visuais são dados
 * validados (src/lib/portal-settings.ts), nunca código: rascunho e versão
 * publicada ficam separados, e cada publicação gera um registro no histórico.
 */
export const clientPortalSettings = pgTable(
  "client_portal_settings",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    /** Configuração em edição (só a equipe vê, na prévia). */
    draft: jsonb().$type<Record<string, unknown>>(),
    /** Configuração exibida aos convidados e no login do portal. */
    published: jsonb().$type<Record<string, unknown>>(),
    /** Versão publicada atual (0 = nunca publicada). */
    version: integer().notNull().default(0),
    publishedAt: tstz(),
    publishedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    /** Página de login com a identidade do cliente ativa. */
    loginEnabled: boolean().notNull().default(true),
    /** Administradores do cliente podem convidar colegas do mesmo cliente. */
    allowGuestInvites: boolean().notNull().default(false),
    updatedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.clientId] }),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
  ],
);

/** Histórico das publicações (permite auditar e restaurar versões anteriores). */
export const clientPortalVersions = pgTable(
  "client_portal_versions",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    version: integer().notNull(),
    settings: jsonb().$type<Record<string, unknown>>().notNull(),
    publishedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.clientId, t.version),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Preferências de notificação por pessoa e organização. Sem registro, vale o
 * padrão (tudo ligado). `email` e `inApp` mapeiam categoria → ligado/desligado.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: jsonb().$type<Record<string, boolean>>().notNull().default({}),
    inApp: jsonb().$type<Record<string, boolean>>().notNull().default({}),
    /** Avisos de mensagens do chat (janela flutuante, som, notificações do sistema). Ver lib/chat-alerts. */
    alerts: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] }), index().on(t.userId)],
);
