import { boolean, index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { domainEvents, organizations } from "./core";

export type AutomationCondition = {
  field: string;
  op: "eq" | "neq" | "in" | "contains" | "gt" | "lt" | "exists";
  value?: unknown;
};

export type AutomationAction =
  | {
      type: "notify_members";
      membershipIds?: string[];
      roleKeys?: string[];
      toAssignee?: boolean;
      toOwner?: boolean;
      title: string;
      body?: string;
    }
  | { type: "notify_client"; title: string; body?: string; email?: boolean }
  | { type: "email"; to: "assignee" | "owner" | "client_users"; subject: string; body: string }
  | { type: "create_task"; title: string; description?: string; assigneeMembershipId?: string; dueInDays?: number }
  | { type: "set_task_status"; statusKey: string }
  | { type: "webhook"; url: string };

/** Regras "quando X acontecer, se Y, faça Z". */
export const automationRules = pgTable(
  "automation_rules",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    trigger: text().notNull(),
    conditions: jsonb().$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb().$type<AutomationAction[]>().notNull().default([]),
    enabled: boolean().notNull().default(true),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    lastRunAt: tstz(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId, t.trigger, t.enabled)],
);

export const automationRunStatus = pgEnum("automation_run_status", ["success", "failed", "skipped"]);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: uuid()
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    eventId: uuid().references(() => domainEvents.id, { onDelete: "set null" }),
    status: automationRunStatus().notNull(),
    result: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    startedAt: tstz().notNull().defaultNow(),
    finishedAt: tstz(),
  },
  (t) => [index().on(t.organizationId, t.ruleId, t.startedAt.desc())],
);
