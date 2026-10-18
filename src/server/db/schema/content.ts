import { date, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { organizations } from "./core";
import { designs } from "./designs";
import { files } from "./files";
import { projects } from "./projects";
import { requests } from "./requests";
import { tasks } from "./tasks";
import { trendAnalyses, trends } from "./trends";

/*
 * Entidades base de conteúdo, compartilhadas pelo Radar de Tendências, pelo
 * calendário editorial e pelos módulos futuros (pré-visualização de redes e
 * Máquina de Conteúdo). Uma peça de conteúdo pertence a um cliente e guarda
 * os textos, a data planejada e os vínculos com tendência, artes, arquivos,
 * tarefa e solicitação — sem duplicar esses registros.
 */

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    name: text().notNull(),
    objective: text(),
    startsOn: date({ mode: "string" }),
    endsOn: date({ mode: "string" }),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.clientId),
  ],
);

export const contentFormat = pgEnum("content_format", ["feed", "stories", "carousel", "reels", "other"]);
export const contentStatus = pgEnum("content_status", [
  "idea",
  "draft",
  "production",
  "review",
  "approved",
  "scheduled",
  "published",
]);

export type ContentSlide = { title: string; text: string };

export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    /* Vínculos opcionais: se o registro de origem for apagado, a peça continua (vínculo vira nulo). */
    campaignId: uuid().references(() => campaigns.id, { onDelete: "set null" }),
    projectId: uuid().references(() => projects.id, { onDelete: "set null" }),
    trendId: uuid().references(() => trends.id, { onDelete: "set null" }),
    trendAnalysisId: uuid().references(() => trendAnalyses.id, { onDelete: "set null" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    requestId: uuid().references(() => requests.id, { onDelete: "set null" }),
    format: contentFormat().notNull().default("feed"),
    status: contentStatus().notNull().default("draft"),
    title: text().notNull(),
    concept: text(),
    strategy: text(),
    copy: text(),
    caption: text(),
    cta: text(),
    script: text(),
    visualDirection: text(),
    imagePrompt: text(),
    hashtags: jsonb().$type<string[]>().notNull().default([]),
    slides: jsonb().$type<ContentSlide[]>().notNull().default([]),
    /** Data planejada (calendário editorial). */
    plannedDate: date({ mode: "string" }),
    /** Rede e formato de destino escolhidos na pré-visualização (ver src/lib/social-specs.ts). */
    network: text().notNull().default("instagram"),
    placement: text(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    updatedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.plannedDate),
    index().on(t.organizationId, t.clientId),
    index().on(t.organizationId, t.campaignId),
    index().on(t.organizationId, t.trendId),
  ],
);

/** Artes (editor) e arquivos ligados a uma peça, sem copiar nada. */
export const contentItemAssets = pgTable(
  "content_item_assets",
  {
    id: id(),
    organizationId: uuid().notNull(),
    contentItemId: uuid().notNull(),
    designId: uuid().references(() => designs.id, { onDelete: "cascade" }),
    fileId: uuid().references(() => files.id, { onDelete: "cascade" }),
    /** feed | stories | slide | image */
    role: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.contentItemId],
      foreignColumns: [contentItems.organizationId, contentItems.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.contentItemId),
  ],
);
