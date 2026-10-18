import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  expenseInput,
  expenseListParams,
  invoiceInput,
  invoiceListParams,
  invoiceTransitionInput,
  invoiceUpdateInput,
  markInvoicePaidInput,
  profitabilityParams,
} from "@/lib/validators/finance";
import type { Tx } from "@/server/db";
import { inSequence } from "@/server/db/sequence";
import { clients, clientServices, counters, expenses, invoices, projects } from "@/server/db/schema";
import { assertCan, assertClientAccess, assertInternal, type Scope } from "@/server/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { diff, recordActivity } from "./activity";

const TZ = "America/Sao_Paulo";
const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const todaySql = sql.raw(`(now() at time zone '${TZ}')::date`);

/** Próximo número sequencial da organização (atômico, sem lacunas por concorrência). */
export async function nextCounter(tx: Tx, organizationId: string, key: string): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ organizationId, key, value: 1 })
    .onConflictDoUpdate({ target: [counters.organizationId, counters.key], set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row!.value;
}

function financeRead(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "finance.read");
}

function financeWrite(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "finance.write");
}

/** Garante que projeto e serviço (se informados) pertencem ao cliente. */
async function assertLinks(s: Scope, clientId: string, projectId: string | null, serviceId: string | null) {
  await assertClientAccess(s, clientId);
  if (projectId) {
    const [p] = await s.db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, projectId));
    if (!p) throw new NotFoundError("Projeto não encontrado.");
    if (p.clientId !== clientId)
      throw new ValidationError("O projeto não pertence a este cliente.", { projectId: ["Projeto de outro cliente"] });
  }
  if (serviceId) {
    const [sv] = await s.db
      .select({ clientId: clientServices.clientId })
      .from(clientServices)
      .where(eq(clientServices.id, serviceId));
    if (!sv) throw new NotFoundError("Serviço não encontrado.");
    if (sv.clientId !== clientId)
      throw new ValidationError("O serviço não pertence a este cliente.", {
        clientServiceId: ["Serviço de outro cliente"],
      });
  }
}

/* ------------------------------------------------------------------ */
/* Visão geral                                                         */
/* ------------------------------------------------------------------ */

export async function financeOverview(s: Scope) {
  financeRead(s);
  const [kpis] = (
    await s.db.execute<{
      mrr: string;
      contracts: number;
      open_sum: string;
      open_count: number;
      overdue_sum: string;
      overdue_count: number;
      received_month: string;
      expenses_month: string;
      expenses_pending: string;
    }>(sql`
      select
        (select coalesce(sum(amount_cents), 0) from client_services
          where status = 'active' and billing_type = 'monthly'
            and (starts_on is null or starts_on <= ${todaySql}) and (ends_on is null or ends_on >= ${todaySql})) as mrr,
        (select count(*)::int from client_services
          where status = 'active' and billing_type = 'monthly'
            and (starts_on is null or starts_on <= ${todaySql}) and (ends_on is null or ends_on >= ${todaySql})) as contracts,
        (select coalesce(sum(amount_cents), 0) from invoices where status = 'open') as open_sum,
        (select count(*)::int from invoices where status = 'open') as open_count,
        (select coalesce(sum(amount_cents), 0) from invoices where status = 'overdue') as overdue_sum,
        (select count(*)::int from invoices where status = 'overdue') as overdue_count,
        (select coalesce(sum(amount_cents), 0) from invoices
          where status = 'paid' and date_trunc('month', paid_at at time zone ${TZ}) = date_trunc('month', now() at time zone ${TZ})) as received_month,
        (select coalesce(sum(amount_cents), 0) from expenses
          where status <> 'cancelled' and date_trunc('month', due_date) = date_trunc('month', ${todaySql})) as expenses_month,
        (select coalesce(sum(amount_cents), 0) from expenses where status = 'pending') as expenses_pending
    `)
  ).rows;

  const projection = (
    await s.db.execute<{ days: number; inflow: string; outflow: string }>(sql`
      select d.days,
        (select coalesce(sum(amount_cents), 0) from invoices
          where status in ('open', 'overdue') and due_date <= ${todaySql} + d.days) as inflow,
        (select coalesce(sum(amount_cents), 0) from expenses
          where status = 'pending' and due_date <= ${todaySql} + d.days) as outflow
      from (values (30), (60), (90)) as d(days)
      order by d.days
    `)
  ).rows.map((r) => ({
    days: r.days,
    inflowCents: Number(r.inflow),
    outflowCents: Number(r.outflow),
    netCents: Number(r.inflow) - Number(r.outflow),
  }));

  const monthly = (
    await s.db.execute<{ month: string; received: string; expenses: string }>(sql`
      with months as (
        select generate_series(
          date_trunc('month', now() at time zone ${TZ}) - interval '5 months',
          date_trunc('month', now() at time zone ${TZ}),
          interval '1 month'
        )::date as month
      )
      select to_char(m.month, 'YYYY-MM') as month,
        (select coalesce(sum(amount_cents), 0) from invoices
          where status = 'paid' and date_trunc('month', paid_at at time zone ${TZ})::date = m.month) as received,
        (select coalesce(sum(amount_cents), 0) from expenses
          where status <> 'cancelled' and date_trunc('month', due_date)::date = m.month) as expenses
      from months m
      order by m.month
    `)
  ).rows.map((r) => ({ month: r.month, receivedCents: Number(r.received), expensesCents: Number(r.expenses) }));

  return {
    mrrCents: Number(kpis?.mrr ?? 0),
    activeContracts: kpis?.contracts ?? 0,
    openCents: Number(kpis?.open_sum ?? 0),
    openCount: kpis?.open_count ?? 0,
    overdueCents: Number(kpis?.overdue_sum ?? 0),
    overdueCount: kpis?.overdue_count ?? 0,
    receivedMonthCents: Number(kpis?.received_month ?? 0),
    expensesMonthCents: Number(kpis?.expenses_month ?? 0),
    expensesPendingCents: Number(kpis?.expenses_pending ?? 0),
    projection,
    monthly,
  };
}

/** MRR atual (para o painel inicial). */
export async function currentMrr(s: Scope): Promise<number> {
  financeRead(s);
  const [row] = await s.db
    .select({ total: sql<string>`coalesce(sum(${clientServices.amountCents}), 0)` })
    .from(clientServices)
    .where(
      and(
        eq(clientServices.status, "active"),
        eq(clientServices.billingType, "monthly"),
        sql`(${clientServices.startsOn} is null or ${clientServices.startsOn} <= ${todaySql})`,
        sql`(${clientServices.endsOn} is null or ${clientServices.endsOn} >= ${todaySql})`,
      ),
    );
  return Number(row?.total ?? 0);
}

/* ------------------------------------------------------------------ */
/* Faturas                                                             */
/* ------------------------------------------------------------------ */

export async function listInvoices(s: Scope, raw: z.input<typeof invoiceListParams>, fixedClientId?: string) {
  financeRead(s);
  const p = invoiceListParams.parse(raw);
  const clientId = fixedClientId ?? p.clientId;
  const asNumber = p.q ? Number(p.q.replace(/^#/, "")) : NaN;
  const where = and(
    p.status ? eq(invoices.status, p.status) : undefined,
    clientId ? eq(invoices.clientId, clientId) : undefined,
    p.from ? gte(invoices.dueDate, p.from) : undefined,
    p.to ? lte(invoices.dueDate, p.to) : undefined,
    p.q
      ? or(
          ilike(invoices.description, ESC(p.q)),
          ilike(clients.name, ESC(p.q)),
          Number.isInteger(asNumber) ? eq(invoices.number, asNumber) : undefined,
        )
      : undefined,
  );
  const [rows, [total], [sums]] = await inSequence(
    () =>
      s.db
        .select({
          id: invoices.id,
          number: invoices.number,
          description: invoices.description,
          amountCents: invoices.amountCents,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          status: invoices.status,
          paidAt: invoices.paidAt,
          paymentMethod: invoices.paymentMethod,
          notes: invoices.notes,
          period: invoices.period,
          clientId: invoices.clientId,
          clientName: clients.name,
          projectId: invoices.projectId,
          projectName: projects.name,
          clientServiceId: invoices.clientServiceId,
        })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .leftJoin(projects, eq(projects.id, invoices.projectId))
        .where(where)
        .orderBy(desc(invoices.dueDate), desc(invoices.number))
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize),
    () => s.db.select({ n: count() }).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId)).where(where),
    () =>
      s.db
        .select({
          total: sql<string>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} <> 'cancelled'), 0)`,
          paid: sql<string>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} = 'paid'), 0)`,
          pending: sql<string>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} in ('open', 'overdue')), 0)`,
        })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(where),
  );
  return {
    rows,
    total: total?.n ?? 0,
    page: p.page,
    pageSize: p.pageSize,
    sums: {
      totalCents: Number(sums?.total ?? 0),
      paidCents: Number(sums?.paid ?? 0),
      pendingCents: Number(sums?.pending ?? 0),
    },
  };
}

export type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>["rows"][number];

export async function createInvoice(s: Scope, raw: z.input<typeof invoiceInput>) {
  financeWrite(s);
  const data = invoiceInput.parse(raw);
  await assertLinks(s, data.clientId, data.projectId, data.clientServiceId);
  const number = await nextCounter(s.db, s.actor.orgId, "invoice");
  const [row] = await s.db
    .insert(invoices)
    .values({
      organizationId: s.actor.orgId,
      number,
      clientId: data.clientId,
      projectId: data.projectId,
      clientServiceId: data.clientServiceId,
      description: data.description,
      amountCents: data.amount!,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      status: data.status,
      notes: data.notes,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: invoices.id });
  await recordActivity(s, {
    action: "created",
    entityType: "invoice",
    entityId: row!.id,
    summary: `Fatura #${number} criada`,
    event: {
      type: "invoice.created",
      payload: { invoiceId: row!.id, clientId: data.clientId, number, amountCents: data.amount, dueDate: data.dueDate },
    },
  });
  return { id: row!.id, number };
}

async function getInvoiceRow(s: Scope, id: string) {
  const [row] = await s.db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) throw new NotFoundError("Fatura não encontrada.");
  return row;
}

export async function updateInvoice(s: Scope, raw: z.input<typeof invoiceUpdateInput>) {
  financeWrite(s);
  const data = invoiceUpdateInput.parse(raw);
  const before = await getInvoiceRow(s, data.id);
  if (before.status === "paid" || before.status === "cancelled") {
    throw new ConflictError("Faturas pagas ou canceladas não podem ser editadas. Desfaça o pagamento ou reabra antes.");
  }
  await assertLinks(s, data.clientId, data.projectId, data.clientServiceId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const patch = {
    clientId: data.clientId,
    projectId: data.projectId,
    clientServiceId: data.clientServiceId,
    description: data.description,
    amountCents: data.amount!,
    issueDate: data.issueDate,
    dueDate: data.dueDate,
    notes: data.notes,
    // Vencimento adiado para o futuro tira a fatura do estado "vencida".
    ...(before.status === "overdue" && data.dueDate >= today ? { status: "open" as const } : {}),
  };
  const changes = diff(before, patch);
  if (!Object.keys(changes).length) return;
  await s.db.update(invoices).set(patch).where(eq(invoices.id, data.id));
  await recordActivity(s, {
    action: "updated",
    entityType: "invoice",
    entityId: data.id,
    summary: `Fatura #${before.number} atualizada`,
    changes,
    event: false,
  });
}

export async function transitionInvoice(s: Scope, raw: z.input<typeof invoiceTransitionInput>) {
  financeWrite(s);
  const data = invoiceTransitionInput.parse(raw);
  const inv = await getInvoiceRow(s, data.id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  let next: typeof inv.status;
  let summary: string;
  switch (data.action) {
    case "issue":
      if (inv.status !== "draft") throw new ConflictError("Só rascunhos podem ser emitidos.");
      next = inv.dueDate < today ? "overdue" : "open";
      summary = `Fatura #${inv.number} emitida`;
      break;
    case "cancel":
      if (inv.status === "paid") throw new ConflictError("Desfaça o pagamento antes de cancelar.");
      if (inv.status === "cancelled") return;
      next = "cancelled";
      summary = `Fatura #${inv.number} cancelada`;
      break;
    case "reopen":
      if (inv.status === "paid") {
        next = inv.dueDate < today ? "overdue" : "open";
        summary = `Pagamento da fatura #${inv.number} desfeito`;
      } else if (inv.status === "cancelled") {
        next = "draft";
        summary = `Fatura #${inv.number} reaberta como rascunho`;
      } else {
        throw new ConflictError("Só faturas pagas ou canceladas podem ser reabertas.");
      }
      break;
  }
  await s.db
    .update(invoices)
    .set({ status: next, ...(data.action === "reopen" ? { paidAt: null, paymentMethod: null } : {}) })
    .where(eq(invoices.id, inv.id));
  await recordActivity(s, {
    action: "status_changed",
    entityType: "invoice",
    entityId: inv.id,
    summary,
    changes: { status: { from: inv.status, to: next } },
    event: false,
  });
}

export async function markInvoicePaid(s: Scope, raw: z.input<typeof markInvoicePaidInput>) {
  financeWrite(s);
  const data = markInvoicePaidInput.parse(raw);
  const inv = await getInvoiceRow(s, data.id);
  if (inv.status === "paid") return;
  if (inv.status === "cancelled") throw new ConflictError("Faturas canceladas não podem ser pagas. Reabra antes.");
  await s.db
    .update(invoices)
    .set({
      status: "paid",
      paidAt: new Date(`${data.paidAt}T12:00:00-03:00`),
      paymentMethod: data.paymentMethod?.trim() || null,
    })
    .where(eq(invoices.id, inv.id));
  await recordActivity(s, {
    action: "paid",
    entityType: "invoice",
    entityId: inv.id,
    summary: `Fatura #${inv.number} paga${data.paymentMethod ? ` (${data.paymentMethod})` : ""}`,
    changes: { status: { from: inv.status, to: "paid" } },
    event: {
      type: "invoice.paid",
      payload: {
        invoiceId: inv.id,
        clientId: inv.clientId,
        number: inv.number,
        amountCents: inv.amountCents,
        dueDate: inv.dueDate,
      },
    },
  });
}

export async function deleteInvoice(s: Scope, id: string) {
  financeWrite(s);
  const inv = await getInvoiceRow(s, id);
  if (inv.status !== "draft")
    throw new ConflictError("Só rascunhos podem ser excluídos. Cancele a fatura para manter o histórico.");
  await s.db.delete(invoices).where(eq(invoices.id, id));
  await recordActivity(s, {
    action: "deleted",
    entityType: "invoice",
    entityId: id,
    summary: `Rascunho de fatura #${inv.number} excluído`,
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Despesas                                                            */
/* ------------------------------------------------------------------ */

export async function listExpenses(s: Scope, raw: z.input<typeof expenseListParams>) {
  financeRead(s);
  const p = expenseListParams.parse(raw);
  const where = and(
    p.status ? eq(expenses.status, p.status) : undefined,
    p.category ? eq(expenses.category, p.category) : undefined,
    p.projectId ? eq(expenses.projectId, p.projectId) : undefined,
    p.from ? gte(expenses.dueDate, p.from) : undefined,
    p.to ? lte(expenses.dueDate, p.to) : undefined,
    p.q ? or(ilike(expenses.description, ESC(p.q)), ilike(expenses.supplier, ESC(p.q))) : undefined,
  );
  const [rows, [total], [sums]] = await inSequence(
    () =>
      s.db
        .select({
          id: expenses.id,
          category: expenses.category,
          supplier: expenses.supplier,
          description: expenses.description,
          amountCents: expenses.amountCents,
          dueDate: expenses.dueDate,
          status: expenses.status,
          paidAt: expenses.paidAt,
          clientId: expenses.clientId,
          clientName: clients.name,
          projectId: expenses.projectId,
          projectName: projects.name,
        })
        .from(expenses)
        .leftJoin(clients, eq(clients.id, expenses.clientId))
        .leftJoin(projects, eq(projects.id, expenses.projectId))
        .where(where)
        .orderBy(desc(expenses.dueDate), desc(expenses.createdAt))
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize),
    () => s.db.select({ n: count() }).from(expenses).where(where),
    () =>
      s.db
        .select({
          total: sql<string>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.status} <> 'cancelled'), 0)`,
          pending: sql<string>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.status} = 'pending'), 0)`,
        })
        .from(expenses)
        .where(where),
  );
  return {
    rows,
    total: total?.n ?? 0,
    page: p.page,
    pageSize: p.pageSize,
    sums: { totalCents: Number(sums?.total ?? 0), pendingCents: Number(sums?.pending ?? 0) },
  };
}

export type ExpenseRow = Awaited<ReturnType<typeof listExpenses>>["rows"][number];

export async function saveExpense(s: Scope, raw: z.input<typeof expenseInput>) {
  financeWrite(s);
  const data = expenseInput.parse(raw);
  let clientId = data.clientId;
  if (data.projectId) {
    const [p] = await s.db
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(eq(projects.id, data.projectId));
    if (!p) throw new NotFoundError("Projeto não encontrado.");
    if (clientId && clientId !== p.clientId)
      throw new ValidationError("O projeto não pertence ao cliente informado.", {
        projectId: ["Projeto de outro cliente"],
      });
    clientId = p.clientId;
  }
  if (clientId) await assertClientAccess(s, clientId);
  const values = {
    clientId,
    projectId: data.projectId,
    category: data.category,
    supplier: data.supplier,
    description: data.description,
    amountCents: data.amount!,
    dueDate: data.dueDate,
    status: data.status,
    paidAt: data.status === "paid" ? new Date(`${data.paidAt ?? data.dueDate}T12:00:00-03:00`) : null,
  };
  if (data.id) {
    const [before] = await s.db.select().from(expenses).where(eq(expenses.id, data.id));
    if (!before) throw new NotFoundError("Despesa não encontrada.");
    await s.db.update(expenses).set(values).where(eq(expenses.id, data.id));
    await recordActivity(s, {
      action: "updated",
      entityType: "expense",
      entityId: data.id,
      summary: `Despesa atualizada: ${data.description}`,
      changes: diff(before, values),
      event: false,
    });
    return { id: data.id };
  }
  const [row] = await s.db
    .insert(expenses)
    .values({ ...values, organizationId: s.actor.orgId, createdByUserId: s.actor.userId })
    .returning({ id: expenses.id });
  await recordActivity(s, {
    action: "created",
    entityType: "expense",
    entityId: row!.id,
    summary: `Despesa lançada: ${data.description}`,
    event: false,
  });
  return { id: row!.id };
}

export async function setExpenseStatus(s: Scope, id: string, status: "pending" | "paid" | "cancelled") {
  financeWrite(s);
  const [before] = await s.db.select().from(expenses).where(eq(expenses.id, id));
  if (!before) throw new NotFoundError("Despesa não encontrada.");
  await s.db
    .update(expenses)
    .set({ status, paidAt: status === "paid" ? new Date() : null })
    .where(eq(expenses.id, id));
  await recordActivity(s, {
    action: "status_changed",
    entityType: "expense",
    entityId: id,
    summary: `Despesa "${before.description}": ${status === "paid" ? "paga" : status === "cancelled" ? "cancelada" : "a pagar"}`,
    event: false,
  });
}

export async function deleteExpense(s: Scope, id: string) {
  financeWrite(s);
  const [row] = await s.db.delete(expenses).where(eq(expenses.id, id)).returning({ description: expenses.description });
  if (!row) throw new NotFoundError("Despesa não encontrada.");
  await recordActivity(s, {
    action: "deleted",
    entityType: "expense",
    entityId: id,
    summary: `Despesa excluída: ${row.description}`,
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Contratos (serviços recorrentes)                                    */
/* ------------------------------------------------------------------ */

export async function listContracts(s: Scope) {
  financeRead(s);
  return s.db
    .select({
      id: clientServices.id,
      name: clientServices.name,
      billingType: clientServices.billingType,
      amountCents: clientServices.amountCents,
      billingDay: clientServices.billingDay,
      startsOn: clientServices.startsOn,
      endsOn: clientServices.endsOn,
      status: clientServices.status,
      clientId: clients.id,
      clientName: clients.name,
      lastInvoiceAt: sql<
        string | null
      >`(select max(${invoices.issueDate})::text from ${invoices} where ${invoices.clientServiceId} = ${clientServices.id})`,
    })
    .from(clientServices)
    .innerJoin(clients, eq(clients.id, clientServices.clientId))
    .orderBy(asc(clientServices.status), asc(clients.name), asc(clientServices.name));
}

/* ------------------------------------------------------------------ */
/* Rentabilidade                                                       */
/* ------------------------------------------------------------------ */

export type ProfitRow = {
  id: string;
  name: string;
  clientName: string | null;
  revenueCents: number;
  laborCents: number;
  minutes: number;
  expensesCents: number;
  profitCents: number;
  margin: number | null;
};

function between(column: SQL, from?: string, to?: string) {
  return sql`${from ? sql`and ${column} >= ${from}::date` : sql``} ${to ? sql`and ${column} <= ${to}::date` : sql``}`;
}

/**
 * Resultado = faturas não canceladas − custo das horas registradas
 * (minutos × custo/hora gravado no lançamento) − despesas não canceladas.
 */
export async function profitability(s: Scope, raw: z.input<typeof profitabilityParams>): Promise<ProfitRow[]> {
  assertInternal(s.actor);
  assertCan(s.actor, "costs.read");
  const p = profitabilityParams.parse(raw);
  const invPeriod = between(sql`i.issue_date`, p.from, p.to);
  const tePeriod = between(sql`(te.started_at at time zone ${TZ})::date`, p.from, p.to);
  const expPeriod = between(sql`e.due_date`, p.from, p.to);

  const result =
    p.by === "project"
      ? await s.db.execute<{
          id: string;
          name: string;
          client_name: string;
          revenue: string;
          labor: string;
          minutes: string;
          expenses: string;
        }>(sql`
          select * from (
            select pr.id, pr.name, c.name as client_name,
              (select coalesce(sum(i.amount_cents), 0) from invoices i where i.project_id = pr.id and i.status <> 'cancelled' ${invPeriod}) as revenue,
              (select coalesce(sum(te.cost_cents), 0) from time_entries te join tasks t on t.id = te.task_id where t.project_id = pr.id ${tePeriod}) as labor,
              (select coalesce(sum(te.minutes), 0) from time_entries te join tasks t on t.id = te.task_id where t.project_id = pr.id ${tePeriod}) as minutes,
              (select coalesce(sum(e.amount_cents), 0) from expenses e where e.project_id = pr.id and e.status <> 'cancelled' ${expPeriod}) as expenses
            from projects pr join clients c on c.id = pr.client_id
          ) x
          where revenue <> 0 or labor <> 0 or expenses <> 0
          order by revenue desc, name
          limit 300
        `)
      : await s.db.execute<{
          id: string;
          name: string;
          client_name: string | null;
          revenue: string;
          labor: string;
          minutes: string;
          expenses: string;
        }>(sql`
          select * from (
            select c.id, c.name, null::text as client_name,
              (select coalesce(sum(i.amount_cents), 0) from invoices i where i.client_id = c.id and i.status <> 'cancelled' ${invPeriod}) as revenue,
              (select coalesce(sum(te.cost_cents), 0) from time_entries te join tasks t on t.id = te.task_id join projects pr on pr.id = t.project_id where pr.client_id = c.id ${tePeriod}) as labor,
              (select coalesce(sum(te.minutes), 0) from time_entries te join tasks t on t.id = te.task_id join projects pr on pr.id = t.project_id where pr.client_id = c.id ${tePeriod}) as minutes,
              (select coalesce(sum(e.amount_cents), 0) from expenses e
                where e.status <> 'cancelled' ${expPeriod}
                  and (e.client_id = c.id or e.project_id in (select id from projects where client_id = c.id))) as expenses
            from clients c
          ) x
          where revenue <> 0 or labor <> 0 or expenses <> 0
          order by revenue desc, name
          limit 300
        `);

  return result.rows.map((r) => {
    const revenue = Number(r.revenue);
    const labor = Number(r.labor);
    const exp = Number(r.expenses);
    const profit = revenue - labor - exp;
    return {
      id: r.id,
      name: r.name,
      clientName: r.client_name,
      revenueCents: revenue,
      laborCents: labor,
      minutes: Number(r.minutes),
      expensesCents: exp,
      profitCents: profit,
      margin: revenue > 0 ? profit / revenue : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Financeiro do cliente                                               */
/* ------------------------------------------------------------------ */

export async function clientFinance(s: Scope, clientId: string) {
  financeRead(s);
  await assertClientAccess(s, clientId);
  const [totals] = (
    await s.db.execute<{ open: string; overdue: string; paid_year: string; mrr: string }>(sql`
      select
        (select coalesce(sum(amount_cents), 0) from invoices where client_id = ${clientId} and status = 'open') as open,
        (select coalesce(sum(amount_cents), 0) from invoices where client_id = ${clientId} and status = 'overdue') as overdue,
        (select coalesce(sum(amount_cents), 0) from invoices where client_id = ${clientId} and status = 'paid'
          and date_trunc('year', paid_at at time zone ${TZ}) = date_trunc('year', now() at time zone ${TZ})) as paid_year,
        (select coalesce(sum(amount_cents), 0) from client_services where client_id = ${clientId} and status = 'active' and billing_type = 'monthly'
          and (starts_on is null or starts_on <= ${todaySql}) and (ends_on is null or ends_on >= ${todaySql})) as mrr
    `)
  ).rows;
  return {
    openCents: Number(totals?.open ?? 0),
    overdueCents: Number(totals?.overdue ?? 0),
    paidYearCents: Number(totals?.paid_year ?? 0),
    mrrCents: Number(totals?.mrr ?? 0),
  };
}

/** Opções para formulários financeiros. */
export async function financeFormOptions(s: Scope) {
  financeRead(s);
  const [clientRows, projectRows, serviceRows] = await inSequence(
    () =>
      s.db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(sql`${clients.archivedAt} is null`)
        .orderBy(asc(clients.name)),
    () =>
      s.db
        .select({ id: projects.id, name: projects.name, clientId: projects.clientId })
        .from(projects)
        .where(sql`${projects.archivedAt} is null`)
        .orderBy(asc(projects.name)),
    () =>
      s.db
        .select({
          id: clientServices.id,
          name: clientServices.name,
          clientId: clientServices.clientId,
          amountCents: clientServices.amountCents,
        })
        .from(clientServices)
        .where(eq(clientServices.status, "active"))
        .orderBy(asc(clientServices.name)),
  );
  return { clients: clientRows, projects: projectRows, services: serviceRows };
}
