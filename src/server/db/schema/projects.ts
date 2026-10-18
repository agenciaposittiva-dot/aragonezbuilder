import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
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
import { memberships, organizations, workflowStatuses } from "./core";

export const priority = pgEnum("priority", ["low", "medium", "high", "urgent"]);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    objective: text(),
    ownerMembershipId: uuid(),
    statusId: uuid().notNull(),
    priority: priority().notNull().default("medium"),
    startDate: date({ mode: "string" }),
    dueDate: date({ mode: "string" }),
    /** Orçamento previsto (centavos). Dado financeiro: oculto do cliente. */
    budgetCents: integer(),
    completedAt: tstz(),
    /** Visível na área do cliente (projetos ocultos não aparecem para os convidados). */
    portalVisible: boolean().notNull().default(true),
    archivedAt: tstz(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.statusId],
      foreignColumns: [workflowStatuses.organizationId, workflowStatuses.id],
    }),
    index().on(t.organizationId, t.clientId),
    index().on(t.organizationId, t.statusId),
    index().on(t.organizationId, t.dueDate),
    index("projects_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    organizationId: uuid().notNull(),
    projectId: uuid().notNull(),
    membershipId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.membershipId] }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("cascade"),
    index().on(t.membershipId),
  ],
);

export const stageStatus = pgEnum("stage_status", ["pending", "active", "done"]);

/** Etapas do projeto (ex.: Planejamento, Criação, Aprovação, Entrega). */
export const projectStages = pgTable(
  "project_stages",
  {
    id: id(),
    organizationId: uuid().notNull(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    position: integer().notNull().default(0),
    status: stageStatus().notNull().default("pending"),
    dueDate: date({ mode: "string" }),
    completedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    index().on(t.projectId, t.position),
  ],
);
