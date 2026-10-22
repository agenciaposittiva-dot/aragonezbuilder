import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { memberships, organizations } from "./core";

export const clientStatus = pgEnum("client_status", ["lead", "active", "paused", "inactive"]);

/**
 * Categorias de clientes da agência (ex.: "Clientes ativos", "Projetos avulsos",
 * "Ex-clientes"), criadas, renomeadas e reordenadas pela equipe. Um cliente fica
 * em no máximo uma categoria (`clients.category_id`); trocar de categoria só muda
 * essa referência — projetos, arquivos e histórico continuam no mesmo cliente.
 */
export const clientCategories = pgTable(
  "client_categories",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Nome de cor da paleta da interface (mesma das etiquetas de tarefa). */
    color: text().notNull().default("slate"),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    uniqueIndex("client_categories_org_name_unique").on(t.organizationId, sql`lower(${t.name})`),
    index().on(t.organizationId, t.position),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Endereço público estável do portal do cliente (único na organização). */
    slug: text().notNull(),
    legalName: text(),
    document: text(),
    email: text(),
    phone: text(),
    website: text(),
    industry: text(),
    address: text(),
    status: clientStatus().notNull().default("active"),
    /** Categoria da agência (opcional). Excluir a categoria só limpa este campo (no serviço). */
    categoryId: uuid(),
    /** Arquivo da biblioteca de marca usado como logotipo (referência validada no serviço). */
    logoFileId: uuid(),
    notesInternal: text(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    archivedAt: tstz(),
    /** Lixeira: preenchido ao excluir; some das listas e é apagado de vez depois de 30 dias. */
    deletedAt: tstz(),
    deletedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("clients_org_slug_unique").on(t.organizationId, t.slug),
    foreignKey({
      columns: [t.organizationId, t.categoryId],
      foreignColumns: [clientCategories.organizationId, clientCategories.id],
    }),
    index().on(t.organizationId, t.status),
    index().on(t.organizationId, t.categoryId),
    index("clients_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    index("clients_trash_idx")
      .on(t.organizationId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: id(),
    organizationId: uuid().notNull(),
    clientId: uuid().notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    position: text(),
    isPrimary: boolean().notNull().default(false),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.clientId),
  ],
);

export const clientMemberRole = pgEnum("client_member_role", ["lead", "member"]);

/** Responsáveis internos pelo cliente. */
export const clientMembers = pgTable(
  "client_members",
  {
    organizationId: uuid().notNull(),
    clientId: uuid().notNull(),
    membershipId: uuid().notNull(),
    role: clientMemberRole().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.membershipId] }),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("cascade"),
    index().on(t.membershipId),
  ],
);

/** Usuários do cliente (papel "client") e os clientes que cada um pode acessar. */
export const clientAccess = pgTable(
  "client_access",
  {
    organizationId: uuid().notNull(),
    clientId: uuid().notNull(),
    membershipId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.membershipId] }),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("cascade"),
    index().on(t.membershipId),
  ],
);

export const billingType = pgEnum("billing_type", ["monthly", "one_time", "hourly"]);
export const serviceStatus = pgEnum("service_status", ["active", "paused", "ended"]);

/** Serviços contratados (também alimentam o módulo financeiro como contratos). */
export const clientServices = pgTable(
  "client_services",
  {
    id: id(),
    organizationId: uuid().notNull(),
    clientId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    billingType: billingType().notNull().default("monthly"),
    amountCents: integer().notNull().default(0),
    /** Dia do mês para faturamento recorrente. */
    billingDay: integer(),
    startsOn: date({ mode: "string" }),
    endsOn: date({ mode: "string" }),
    status: serviceStatus().notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
    index().on(t.clientId),
  ],
);

export type BrandColor = { name: string; hex: string; usage?: string };
export type BrandFont = { name: string; usage?: string; source?: string };

/** Identidade e contexto do cliente (usado pelos módulos de criação e IA). */
export const brandProfiles = pgTable(
  "brand_profiles",
  {
    clientId: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    toneOfVoice: text(),
    audience: text(),
    objectives: text(),
    positioning: text(),
    keywords: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    avoid: text(),
    guidelines: text(),
    colors: jsonb().$type<BrandColor[]>().notNull().default([]),
    fonts: jsonb().$type<BrandFont[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }).onDelete("cascade"),
  ],
);
