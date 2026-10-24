import { foreignKey, index, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { MachineState } from "@/lib/content-machine";
import { timestamps, id, tstz } from "./_helpers";
import { user } from "./auth";
import { clients } from "./clients";
import { campaigns, contentItems } from "./content";
import { organizations } from "./core";
import { designs } from "./designs";
import { projects } from "./projects";
import { trends } from "./trends";

/*
 * Máquina de Conteúdo: um projeto por criação guiada. Guarda as decisões do
 * assistente (estado) e aponta para o que foi produzido — a arte do editor e a
 * peça de conteúdo, que já ligam calendário, tarefas, aprovações e portal.
 * Nada é copiado: se a arte ou a peça forem apagadas, o vínculo vira nulo.
 */

export const machineProjectStatus = pgEnum("machine_project_status", ["draft", "generating", "ready", "archived"]);

export const contentMachineProjects = pgTable(
  "content_machine_projects",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid().notNull(),
    campaignId: uuid().references(() => campaigns.id, { onDelete: "set null" }),
    projectId: uuid().references(() => projects.id, { onDelete: "set null" }),
    trendId: uuid().references(() => trends.id, { onDelete: "set null" }),
    designId: uuid().references(() => designs.id, { onDelete: "set null" }),
    contentItemId: uuid().references(() => contentItems.id, { onDelete: "set null" }),
    title: text().notNull(),
    status: machineProjectStatus().notNull().default("draft"),
    /** Etapa atual do assistente (1–9). */
    step: integer().notNull().default(1),
    state: jsonb().$type<MachineState>().notNull(),
    /** Controle do salvamento automático (outra aba não sobrescreve sem aviso). */
    revision: integer().notNull().default(1),
    lastError: text(),
    archivedAt: tstz(),
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
    index().on(t.organizationId, t.updatedAt),
    index().on(t.organizationId, t.clientId),
  ],
);
