import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { organizations } from "./core";
import { files } from "./files";
import { projects } from "./projects";
import { tasks } from "./tasks";

/**
 * Documentos do editor de artes. `document` guarda o JSON da cena (objetos,
 * camadas, textos). Exportar uma arte gera uma nova versão em `files`.
 */
export const designs = pgTable(
  "designs",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid(),
    projectId: uuid(),
    taskId: uuid(),
    name: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    document: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Prévia em data URL compacta (JPEG pequeno) para listagens. */
    thumbnail: text(),
    isTemplate: boolean().notNull().default(false),
    templateCategory: text(),
    /** Arquivo gerado pela última exportação. */
    outputFileId: uuid(),
    revision: integer().notNull().default(1),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    updatedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    archivedAt: tstz(),
    /** Lixeira: preenchido ao excluir; some das listas e é apagado de vez depois de 30 dias. */
    deletedAt: tstz(),
    deletedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.outputFileId],
      foreignColumns: [files.organizationId, files.id],
    }),
    index().on(t.organizationId, t.isTemplate, t.updatedAt.desc()),
    index("designs_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    index("designs_trash_idx").on(t.organizationId, t.deletedAt).where(sql`${t.deletedAt} is not null`),
  ],
);
