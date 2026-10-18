import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { organizations } from "./core";
import { files, fileVersions } from "./files";
import { projects } from "./projects";
import { requests } from "./requests";
import { tasks } from "./tasks";

/**
 * Comentários. Cada comentário pertence a exatamente um alvo (projeto, tarefa,
 * solicitação ou arquivo). Comentários internos nunca são exibidos ao cliente.
 */
export const comments = pgTable(
  "comments",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authorUserId: text().references(() => user.id, { onDelete: "set null" }),
    body: text().notNull(),
    internal: boolean().notNull().default(true),
    projectId: uuid(),
    taskId: uuid(),
    requestId: uuid(),
    fileId: uuid(),
    /** Para comentários em arquivos: a versão comentada. */
    fileVersionId: uuid(),
    editedAt: tstz(),
    deletedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.requestId],
      foreignColumns: [requests.organizationId, requests.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.fileId],
      foreignColumns: [files.organizationId, files.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.fileVersionId],
      foreignColumns: [fileVersions.organizationId, fileVersions.id],
    }).onDelete("cascade"),
    check("comments_single_target", sql`num_nonnulls(${t.projectId}, ${t.taskId}, ${t.requestId}, ${t.fileId}) = 1`),
    index().on(t.projectId, t.createdAt),
    index().on(t.taskId, t.createdAt),
    index().on(t.requestId, t.createdAt),
    index().on(t.fileId, t.createdAt),
  ],
);
