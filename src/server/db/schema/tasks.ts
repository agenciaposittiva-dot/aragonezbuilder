import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { memberships, organizations, workflowStatuses } from "./core";
import { priority, projects, projectStages } from "./projects";
import { requests } from "./requests";

export const recurrenceFrequency = pgEnum("recurrence_frequency", ["daily", "weekly", "monthly"]);

/**
 * Rotina: regra que cria uma tarefa (demanda) recorrente num projeto — todo
 * dia, toda semana num dia da semana ou todo mês num dia do mês. O worker/cron
 * gera a tarefa na data (`next_run_on`) e avança para a próxima; a tarefa
 * gerada guarda `recurrence_id` + `recurrence_on` (único: nunca duplica).
 */
export const taskRecurrences = pgTable(
  "task_recurrences",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    title: text().notNull(),
    description: text(),
    assigneeMembershipId: uuid(),
    priority: priority().notNull().default("medium"),
    frequency: recurrenceFrequency().notNull(),
    /** A cada N dias/semanas/meses. */
    interval: integer().notNull().default(1),
    /** Semanal: 0 (domingo) a 6 (sábado). */
    weekday: integer(),
    /** Mensal: 1 a 28 (evita meses curtos). */
    monthday: integer(),
    /** Prazo da tarefa gerada: dias depois da data da ocorrência (0 = no mesmo dia). */
    dueInDays: integer().notNull().default(0),
    nextRunOn: date({ mode: "string" }).notNull(),
    active: boolean().notNull().default(true),
    lastRunOn: date({ mode: "string" }),
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
      columns: [t.organizationId, t.assigneeMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    index().on(t.active, t.nextRunOn),
    check("task_recurrences_interval", sql`${t.interval} between 1 and 12`),
    check("task_recurrences_weekday", sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
    check("task_recurrences_monthday", sql`${t.monthday} is null or ${t.monthday} between 1 and 28`),
    check("task_recurrences_due", sql`${t.dueInDays} between 0 and 60`),
  ],
);

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
    /** Gerada por uma rotina (e em qual data): impede gerar a mesma ocorrência duas vezes. */
    recurrenceId: uuid().references((): AnyPgColumn => taskRecurrences.id, { onDelete: "set null" }),
    recurrenceOn: date({ mode: "string" }),
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
    index("tasks_trash_idx")
      .on(t.organizationId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    uniqueIndex("tasks_recurrence_occurrence_unique")
      .on(t.recurrenceId, t.recurrenceOn)
      .where(sql`${t.recurrenceId} is not null`),
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

/* ------------------------------------------------------------------ */
/* Etiquetas, filtros salvos e modelos de tarefa                       */
/* ------------------------------------------------------------------ */

/** Etiquetas por organização (nome único, sem diferenciar maiúsculas). */
export const taskLabels = pgTable(
  "task_labels",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Nome de cor da paleta da interface (ex.: "blue", "green"). */
    color: text().notNull().default("slate"),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    uniqueIndex("task_labels_org_name_unique").on(t.organizationId, sql`lower(${t.name})`),
  ],
);

export const taskLabelLinks = pgTable(
  "task_label_links",
  {
    organizationId: uuid().notNull(),
    taskId: uuid().notNull(),
    labelId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.labelId],
      foreignColumns: [taskLabels.organizationId, taskLabels.id],
    }).onDelete("cascade"),
    index().on(t.labelId),
  ],
);

/** Filtros salvos da central de tarefas, por pessoa. `query` é a busca da URL, revalidada ao usar. */
export const taskSavedViews = pgTable(
  "task_saved_views",
  {
    id: id(),
    organizationId: uuid().notNull(),
    membershipId: uuid().notNull(),
    name: text().notNull(),
    query: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.membershipId),
  ],
);

/**
 * Modelos de processo: uma tarefa principal com etapas (subtarefas) e
 * checklist. Os prazos são deslocamentos em dias a partir da data de início
 * escolhida ao aplicar o modelo.
 */
export const taskTemplates = pgTable(
  "task_templates",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    priority: priority().notNull().default("medium"),
    /** Prazo da tarefa principal, em dias após o início. */
    dueOffsetDays: integer(),
    estimateMinutes: integer(),
    checklist: jsonb().$type<string[]>().notNull().default([]),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.id)],
);

export const taskTemplateSteps = pgTable(
  "task_template_steps",
  {
    id: id(),
    organizationId: uuid().notNull(),
    templateId: uuid().notNull(),
    position: integer().notNull().default(0),
    title: text().notNull(),
    dueOffsetDays: integer(),
    estimateMinutes: integer(),
    checklist: jsonb().$type<string[]>().notNull().default([]),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [taskTemplates.organizationId, taskTemplates.id],
    }).onDelete("cascade"),
    index().on(t.templateId, t.position),
  ],
);
