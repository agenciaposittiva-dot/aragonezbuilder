import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
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
    /** Nome informado por quem decidiu pelo link de aprovação (sem conta; `decidedByUserId` fica nulo). */
    decidedByName: text(),
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

/**
 * Link de aprovação sem conta: o cliente abre `/aprovar/<token>`, vê a versão
 * atual de cada arquivo do link e aprova ou pede ajustes. Só o hash do token é
 * guardado (como nos convites). As decisões vão para as mesmas `approvals`.
 */
export const approvalLinks = pgTable(
  "approval_links",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    label: text().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: tstz().notNull(),
    revokedAt: tstz(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastViewedAt: tstz(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.clientId, t.createdAt.desc()),
  ],
);

/** Arquivos de um link de aprovação (a versão exibida é sempre a atual do arquivo). */
export const approvalLinkItems = pgTable(
  "approval_link_items",
  {
    organizationId: uuid().notNull(),
    linkId: uuid().notNull(),
    fileId: uuid().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.fileId] }),
    foreignKey({
      columns: [t.organizationId, t.linkId],
      foreignColumns: [approvalLinks.organizationId, approvalLinks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.fileId],
      foreignColumns: [files.organizationId, files.id],
    }).onDelete("cascade"),
    index().on(t.fileId),
  ],
);
