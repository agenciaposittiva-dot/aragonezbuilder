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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { OrgSettings } from "@/lib/org-settings";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";

/* ------------------------------------------------------------------ */
/* Organizações (tenants)                                              */
/* ------------------------------------------------------------------ */

export const organizations = pgTable("organizations", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logoUrl: text(),
  settings: jsonb().$type<Partial<OrgSettings>>().notNull().default({}),
  ...timestamps,
});

export const roleKind = pgEnum("role_kind", ["internal", "client"]);

/** Papéis por organização. Os papéis de sistema são criados junto com a organização. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    kind: roleKind().notNull().default("internal"),
    permissions: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isSystem: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.key), unique().on(t.organizationId, t.id)],
);

export const membershipStatus = pgEnum("membership_status", ["active", "suspended", "removed"]);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid().notNull(),
    status: membershipStatus().notNull().default("active"),
    jobTitle: text(),
    specialties: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Capacidade semanal em minutos (para carga de trabalho). */
    weeklyCapacityMinutes: integer().notNull().default(2400),
    /** Custo interno por hora em centavos. Visível apenas com `costs.read`. */
    hourlyCostCents: integer(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.userId),
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    index().on(t.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    /** Nome do convidado, quando informado. */
    name: text(),
    roleId: uuid().notNull(),
    /** Para convites de clientes: os clientes que o usuário poderá acessar. */
    clientIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    tokenHash: text().notNull().unique(),
    invitedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    expiresAt: tstz().notNull(),
    acceptedAt: tstz(),
    revokedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    index().on(t.organizationId, t.email),
  ],
);

/* ------------------------------------------------------------------ */
/* Status configuráveis (projetos e tarefas)                           */
/* ------------------------------------------------------------------ */

export const workflowEntity = pgEnum("workflow_entity", ["project", "task"]);
export const statusCategory = pgEnum("status_category", [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
  "cancelled",
]);

export const workflowStatuses = pgTable(
  "workflow_statuses",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entity: workflowEntity().notNull(),
    key: text().notNull(),
    name: text().notNull(),
    category: statusCategory().notNull(),
    color: text().notNull().default("slate"),
    position: integer().notNull().default(0),
    isDefault: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.entity, t.key),
    unique().on(t.organizationId, t.id),
    uniqueIndex("workflow_statuses_one_default")
      .on(t.organizationId, t.entity)
      .where(sql`${t.isDefault}`),
  ],
);

/**
 * Transições permitidas. Se um status não tiver nenhuma transição cadastrada,
 * qualquer destino é permitido a partir dele.
 */
export const workflowTransitions = pgTable(
  "workflow_transitions",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fromStatusId: uuid().notNull(),
    toStatusId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromStatusId, t.toStatusId] }),
    foreignKey({
      columns: [t.organizationId, t.fromStatusId],
      foreignColumns: [workflowStatuses.organizationId, workflowStatuses.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.toStatusId],
      foreignColumns: [workflowStatuses.organizationId, workflowStatuses.id],
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------ */
/* Contadores sequenciais por organização (nº de solicitação, fatura)  */
/* ------------------------------------------------------------------ */

export const counters = pgTable(
  "counters",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text().notNull(),
    value: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

/* ------------------------------------------------------------------ */
/* Auditoria, eventos de domínio (outbox) e notificações               */
/* ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: text().references(() => user.id, { onDelete: "set null" }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    summary: text(),
    changes: jsonb().$type<Record<string, { from: unknown; to: unknown }>>(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    /** Visível ao cliente no histórico do portal. */
    clientVisible: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.organizationId, t.entityType, t.entityId, t.createdAt.desc()),
    index().on(t.organizationId, t.createdAt.desc()),
  ],
);

export const domainEvents = pgTable(
  "domain_events",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    processedAt: tstz(),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [
    index("domain_events_pending")
      .on(t.createdAt)
      .where(sql`${t.processedAt} is null`),
    index().on(t.organizationId, t.type, t.createdAt.desc()),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    link: text(),
    entityType: text(),
    entityId: uuid(),
    readAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.userId, t.readAt, t.createdAt.desc())],
);
