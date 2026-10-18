import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { memberships, organizations } from "./core";
import { priority, projects } from "./projects";

export const briefingCategory = pgEnum("briefing_category", [
  "design",
  "social_media",
  "video",
  "campaign",
  "presentation",
  "branding",
  "copy",
  "website",
  "other",
]);

export type BriefingFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "url"
  | "select"
  | "multiselect"
  | "checkbox";

export type BriefingField = {
  key: string;
  label: string;
  type: BriefingFieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
};

/** Modelos de briefing configuráveis por organização, sem alteração de código. */
export const briefingTemplates = pgTable(
  "briefing_templates",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    category: briefingCategory().notNull().default("other"),
    description: text(),
    fields: jsonb().$type<BriefingField[]>().notNull().default([]),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.id)],
);

export const requestStatus = pgEnum("request_status", [
  "draft",
  "submitted",
  "triage",
  "in_progress",
  "delivered",
  "rejected",
  "cancelled",
]);

/** Solicitações (demandas) feitas por clientes ou pelo atendimento. */
export const requests = pgTable(
  "requests",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    clientId: uuid().notNull(),
    templateId: uuid(),
    title: text().notNull(),
    category: briefingCategory().notNull().default("other"),
    objective: text(),
    description: text(),
    audience: text(),
    channel: text(),
    format: text(),
    piecesCount: integer(),
    desiredDueDate: date({ mode: "string" }),
    priority: priority().notNull().default("medium"),
    status: requestStatus().notNull().default("submitted"),
    briefing: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    references: text(),
    copyText: text(),
    assigneeMembershipId: uuid(),
    projectId: uuid(),
    rejectionReason: text(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    submittedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [briefingTemplates.organizationId, briefingTemplates.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.assigneeMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
    index().on(t.organizationId, t.status),
    index().on(t.organizationId, t.clientId),
  ],
);
