import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tstz } from "./_helpers";
import { user } from "./auth";
import { organizations } from "./core";
import { files, fileVersions } from "./files";
import { tasks } from "./tasks";

export const approvalStage = pgEnum("approval_stage", ["internal", "client"]);
export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "changes_requested",
  "superseded",
  "cancelled",
]);

/**
 * Rodadas de aprovação. Toda decisão pertence a UMA versão de arquivo;
 * uma nova versão nunca herda a aprovação da anterior.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fileId: uuid().notNull(),
    fileVersionId: uuid().notNull(),
    taskId: uuid(),
    stage: approvalStage().notNull(),
    status: approvalStatus().notNull().default("pending"),
    message: text(),
    dueDate: date({ mode: "string" }),
    requestedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    requestedAt: createdAt(),
    decidedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    decidedAt: tstz(),
    decisionNote: text(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.fileId],
      foreignColumns: [files.organizationId, files.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.fileVersionId],
      foreignColumns: [fileVersions.organizationId, fileVersions.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }),
    uniqueIndex("approvals_one_pending_per_stage")
      .on(t.fileVersionId, t.stage)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.organizationId, t.status, t.stage),
    index().on(t.fileId, t.requestedAt.desc()),
    check(
      "approvals_decision_consistency",
      sql`(${t.status} in ('approved','changes_requested')) = (${t.decidedAt} is not null)`,
    ),
  ],
);
