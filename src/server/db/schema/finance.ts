import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { clients, clientServices } from "./clients";
import { organizations } from "./core";
import { projects } from "./projects";

export const invoiceStatus = pgEnum("invoice_status", ["draft", "open", "paid", "overdue", "cancelled"]);

/** Contas a receber. */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    clientId: uuid().notNull(),
    projectId: uuid(),
    clientServiceId: uuid(),
    description: text().notNull(),
    amountCents: integer().notNull(),
    issueDate: date({ mode: "string" }).notNull(),
    dueDate: date({ mode: "string" }).notNull(),
    /** Competência (YYYY-MM) para faturas recorrentes; evita gerar duas vezes. */
    period: text(),
    status: invoiceStatus().notNull().default("open"),
    paidAt: tstz(),
    paymentMethod: text(),
    notes: text(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.number),
    unique("invoices_service_period").on(t.organizationId, t.clientServiceId, t.period),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.clientServiceId],
      foreignColumns: [clientServices.organizationId, clientServices.id],
    }),
    index().on(t.organizationId, t.status, t.dueDate),
    index().on(t.organizationId, t.clientId),
    check("invoices_amount_positive", sql`${t.amountCents} >= 0`),
  ],
);

export const expenseStatus = pgEnum("expense_status", ["pending", "paid", "cancelled"]);

/** Contas a pagar / custos diretos (podem ser associados a projeto e cliente). */
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid(),
    projectId: uuid(),
    category: text().notNull(),
    supplier: text(),
    description: text().notNull(),
    amountCents: integer().notNull(),
    dueDate: date({ mode: "string" }).notNull(),
    status: expenseStatus().notNull().default("pending"),
    paidAt: tstz(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
    index().on(t.organizationId, t.status, t.dueDate),
    index().on(t.organizationId, t.projectId),
    check("expenses_amount_positive", sql`${t.amountCents} >= 0`),
  ],
);
