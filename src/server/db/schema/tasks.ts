import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { memberships, organizations, workflowStatuses } from "./core";
import { priority, projects, projectStages } from "./projects";
import { requests } from "./requests";

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    parentTaskId: uuid().references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    stageId: uuid(),
    requestId: uuid(),
    title: text().notNull(),
    description: text(),
    statusId: uuid().notNull(),
    priority: priority().notNull().default("medium"),
    assigneeMembershipId: uuid(),
    startDate: date({ mode: "string" }),
    dueDate: date({ mode: "string" }),
    estimateMinutes: integer(),
    /** Ordem no Kanban dentro da coluna (índice fracionário). */
    position: doublePrecision().notNull().default(0),
    completedAt: tstz(),
    archivedAt: tstz(),
    /**
     * Lixeira: ao excluir, `deleted_at` e `archived_at` recebem a mesma data (a
     * tarefa some de todas as listas que já ignoram arquivadas). Restaurar limpa
     * os dois — `archived_at` só quando foi a exclusão que o preencheu.
     */
    deletedAt: tstz(),
    deletedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.statusId],
      foreignColumns: [workflowStatuses.organizationId, workflowStatuses.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.stageId],
      foreignColumns: [projectStages.organizationId, projectStages.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.requestId],
      foreignColumns: [requests.organizationId, requests.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.assigneeMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    index().on(t.organizationId, t.projectId, t.statusId, t.position),
    index().on(t.organizationId, t.assigneeMembershipId, t.dueDate),
    index().on(t.parentTaskId),
    index("tasks_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
    index("tasks_trash_idx").on(t.organizationId, t.deletedAt).where(sql`${t.deletedAt} is not null`),
  ],
);

export const taskCollaborators = pgTable(
  "task_collaborators",
  {
    organizationId: uuid().notNull(),
    taskId: uuid().notNull(),
    membershipId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.membershipId] }),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("cascade"),
    index().on(t.membershipId),
  ],
);

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: id(),
    organizationId: uuid().notNull(),
    taskId: uuid().notNull(),
    title: text().notNull(),
    done: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    doneAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }).onDelete("cascade"),
    index().on(t.taskId, t.position),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    organizationId: uuid().notNull(),
    taskId: uuid().notNull(),
    dependsOnTaskId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.dependsOnTaskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }).onDelete("cascade"),
    check("task_dependencies_not_self", sql`${t.taskId} <> ${t.dependsOnTaskId}`),
  ],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    organizationId: uuid().notNull(),
    taskId: uuid().notNull(),
    membershipId: uuid().notNull(),
    startedAt: tstz().notNull(),
    endedAt: tstz(),
    minutes: integer().notNull().default(0),
    note: text(),
    billable: boolean().notNull().default(true),
    /** Custo do registro (minutos × custo/hora do membro no momento do lançamento). */
    costCents: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    index().on(t.organizationId, t.membershipId, t.startedAt),
    index().on(t.taskId),
    check("time_entries_minutes_positive", sql`${t.minutes} >= 0`),
  ],
);
