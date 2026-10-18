import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { organizations } from "./core";
import { projects } from "./projects";
import { requests } from "./requests";
import { tasks } from "./tasks";

export const folders = pgTable(
  "folders",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid(),
    projectId: uuid(),
    parentId: uuid(),
    name: text().notNull(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.parentId],
      foreignColumns: [t.organizationId, t.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.parentId),
  ],
);

export const fileCategory = pgEnum("file_category", [
  "general",
  "deliverable",
  "reference",
  "document",
  "brand_logo",
  "brand_asset",
  "brand_guideline",
  "template",
]);

export const fileStatus = pgEnum("file_status", [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "final",
  "archived",
]);

export const files = pgTable(
  "files",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid(),
    projectId: uuid(),
    taskId: uuid(),
    requestId: uuid(),
    folderId: uuid(),
    name: text().notNull(),
    description: text(),
    category: fileCategory().notNull().default("general"),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    status: fileStatus().notNull().default("draft"),
    /** Só arquivos compartilhados explicitamente aparecem para o cliente. */
    sharedWithClient: boolean().notNull().default(false),
    currentVersionId: uuid().references((): AnyPgColumn => fileVersions.id, { onDelete: "set null" }),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    deletedAt: tstz(),
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
      columns: [t.organizationId, t.requestId],
      foreignColumns: [requests.organizationId, requests.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.folderId],
      foreignColumns: [folders.organizationId, folders.id],
    }),
    index().on(t.organizationId, t.clientId, t.category),
    index().on(t.organizationId, t.projectId),
    index().on(t.organizationId, t.taskId),
    index().on(t.organizationId, t.folderId),
    index("files_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    index("files_tags_gin").using("gin", t.tags),
  ],
);

export const fileSource = pgEnum("file_source", ["upload", "editor", "ai"]);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: id(),
    organizationId: uuid().notNull(),
    fileId: uuid().notNull(),
    versionNumber: integer().notNull(),
    storageKey: text().notNull(),
    originalName: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    checksumSha256: text(),
    width: integer(),
    height: integer(),
    thumbnailKey: text(),
    note: text(),
    source: fileSource().notNull().default("upload"),
    uploadedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.fileId, t.versionNumber),
    foreignKey({
      columns: [t.organizationId, t.fileId],
      foreignColumns: [files.organizationId, files.id],
    }).onDelete("cascade"),
  ],
);

export const fileFavorites = pgTable(
  "file_favorites",
  {
    organizationId: uuid().notNull(),
    fileId: uuid().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.fileId],
      foreignColumns: [files.organizationId, files.id],
    }).onDelete("cascade"),
  ],
);
