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
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { memberships, organizations } from "./core";

export const clientStatus = pgEnum("client_status", ["lead", "active", "paused", "inactive"]);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    legalName: text(),
    document: text(),
    email: text(),
    phone: text(),
    website: text(),
    industry: text(),
    address: text(),
    status: clientStatus().notNull().default("active"),
    /** Arquivo da biblioteca de marca usado como logotipo (referência validada no serviço). */
    logoFileId: uuid(),
    notesInternal: text(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    index().on(t.organizationId, t.status),
    index("clients_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
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
