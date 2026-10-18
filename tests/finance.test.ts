import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { domainEvents, invoices, tasks, timeEntries } from "@/server/db/schema";
import { generateRecurringInvoices, markOverdueInvoices } from "@/server/events/schedules";
import { createClient, saveService } from "@/server/services/clients";
import {
  createInvoice,
  deleteInvoice,
  listInvoices,
  markInvoicePaid,
  profitability,
  saveExpense,
  transitionInvoice,
  updateInvoice,
} from "@/server/services/finance";
import { createProject } from "@/server/services/projects";
import { getDefaultStatus } from "@/server/services/workflow";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

describe("financeiro", () => {
  let a: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let b: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientA: string;
  let clientB: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Fin A");
    b = await createOrgWithOwner("Agência Fin B");
    clientA = (await as(a.actor, (s) => createClient(s, { name: "Cliente A" }))).id;
    clientB = (await as(b.actor, (s) => createClient(s, { name: "Cliente B" }))).id;
  });

  it("numera faturas em sequência, por organização, e converte o valor uma única vez", async () => {
    const base = { description: "Serviço", issueDate: "2026-10-01", dueDate: "2026-10-10" };
    const n1 = await as(a.actor, (s) => createInvoice(s, { ...base, clientId: clientA, amount: "2.500,00" }));
    const n2 = await as(a.actor, (s) => createInvoice(s, { ...base, clientId: clientA, amount: "100" }));
    const n3 = await as(a.actor, (s) => createInvoice(s, { ...base, clientId: clientA, amount: 10.5 }));
    const nb = await as(b.actor, (s) => createInvoice(s, { ...base, clientId: clientB, amount: "1" }));
    expect([n1.number, n2.number, n3.number]).toEqual([1, 2, 3]);
    expect(nb.number).toBe(1);
    const [row] = await withOrg(a.org.id, (tx) => tx.select().from(invoices).where(eq(invoices.id, n1.id)));
    expect(row!.amountCents).toBe(250000);
  });

  it("não permite usar cliente de outra organização", async () => {
    await expect(
      as(a.actor, (s) =>
        createInvoice(s, {
          clientId: clientB,
          description: "x",
          amount: "1",
          issueDate: "2026-10-01",
          dueDate: "2026-10-02",
        }),
      ),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("marca como vencidas apenas faturas em aberto com vencimento passado (idempotente)", async () => {
    const past = await as(a.actor, (s) =>
      createInvoice(s, {
        clientId: clientA,
        description: "Antiga",
        amount: "50",
        issueDate: "2026-01-01",
        dueDate: "2026-01-10",
      }),
    );
    const future = await as(a.actor, (s) =>
      createInvoice(s, {
        clientId: clientA,
        description: "Futura",
        amount: "50",
        issueDate: "2026-01-01",
        dueDate: "2099-01-10",
      }),
    );
    expect(await markOverdueInvoices()).toBeGreaterThanOrEqual(1);
    const rows = await withOrg(a.org.id, (tx) => tx.select().from(invoices));
    expect(rows.find((r) => r.id === past.id)?.status).toBe("overdue");
    expect(rows.find((r) => r.id === future.id)?.status).toBe("open");
    const events = await withOrg(a.org.id, (tx) =>
      tx.select().from(domainEvents).where(eq(domainEvents.entityId, past.id)),
    );
    expect(events.some((e) => e.type === "invoice.overdue")).toBe(true);
    const again = await withOrg(a.org.id, async () => markOverdueInvoices());
    expect(again).toBe(0);
  });

  it("gera faturas recorrentes uma única vez por competência", async () => {
    const svc = await as(a.actor, (s) =>
      saveService(s, {
        clientId: clientA,
        name: "Gestão de redes",
        amount: "3.000,00",
        billingDay: 5,
        billingType: "monthly",
      }),
    );
    expect(await generateRecurringInvoices("2026-11-03")).toBe(0); // antes do dia de faturamento
    expect(await generateRecurringInvoices("2026-11-05")).toBe(1);
    expect(await generateRecurringInvoices("2026-11-20")).toBe(0);
    expect(await generateRecurringInvoices("2026-12-06")).toBe(1);
    const rows = await withOrg(a.org.id, (tx) =>
      tx.select().from(invoices).where(eq(invoices.clientServiceId, svc.id)),
    );
    expect(rows.map((r) => r.period).sort()).toEqual(["2026-11", "2026-12"]);
    expect(rows.every((r) => r.amountCents === 300000)).toBe(true);
    expect(rows.find((r) => r.period === "2026-11")?.dueDate).toBe("2026-11-12");
  });

  it("controla o ciclo de vida da fatura", async () => {
    const inv = await as(a.actor, (s) =>
      createInvoice(s, {
        clientId: clientA,
        description: "Ciclo",
        amount: "10",
        issueDate: "2026-10-01",
        dueDate: "2099-10-10",
        status: "draft",
      }),
    );
    await as(a.actor, (s) => transitionInvoice(s, { id: inv.id, action: "issue" }));
    await as(a.actor, (s) => markInvoicePaid(s, { id: inv.id, paidAt: "2026-10-05", paymentMethod: "PIX" }));
    await expect(
      as(a.actor, (s) =>
        updateInvoice(s, {
          id: inv.id,
          clientId: clientA,
          description: "x",
          amount: "1",
          issueDate: "2026-10-01",
          dueDate: "2099-10-10",
        }),
      ),
    ).rejects.toThrow(/pagas/);
    await expect(as(a.actor, (s) => deleteInvoice(s, inv.id))).rejects.toThrow(/rascunhos/);
    await as(a.actor, (s) => transitionInvoice(s, { id: inv.id, action: "reopen" }));
    const [row] = await withOrg(a.org.id, (tx) => tx.select().from(invoices).where(eq(invoices.id, inv.id)));
    expect(row!.status).toBe("open");
    expect(row!.paidAt).toBeNull();
  });

  it("calcula a rentabilidade com receita, horas e despesas", async () => {
    const projectId = (await as(a.actor, (s) => createProject(s, { clientId: clientA, name: "Projeto Rentável" }))).id;
    await as(a.actor, (s) =>
      createInvoice(s, {
        clientId: clientA,
        projectId,
        description: "Projeto",
        amount: "100,00",
        issueDate: "2026-10-01",
        dueDate: "2026-10-30",
      }),
    );
    await as(a.actor, (s) =>
      saveExpense(s, {
        projectId,
        category: "Freelancer",
        description: "Ilustração",
        amount: "10,00",
        dueDate: "2026-10-15",
      }),
    );
    const status = await as(a.actor, (s) => getDefaultStatus(s, "task"));
    await withOrg(a.org.id, async (tx) => {
      const [t] = await tx
        .insert(tasks)
        .values({ organizationId: a.org.id, projectId, title: "Arte", statusId: status.id })
        .returning({ id: tasks.id });
      await tx.insert(timeEntries).values({
        organizationId: a.org.id,
        taskId: t!.id,
        membershipId: a.actor.membershipId,
        startedAt: new Date("2026-10-02T13:00:00Z"),
        minutes: 120,
        costCents: 3000,
      });
    });
    const rows = await as(a.actor, (s) => profitability(s, { by: "project" }));
    const row = rows.find((r) => r.id === projectId)!;
    expect(row.revenueCents).toBe(10000);
    expect(row.laborCents).toBe(3000);
    expect(row.expensesCents).toBe(1000);
    expect(row.profitCents).toBe(6000);
    expect(row.margin).toBeCloseTo(0.6);
    expect(row.minutes).toBe(120);
    const byClient = await as(a.actor, (s) => profitability(s, { by: "client" }));
    expect(byClient.find((r) => r.id === clientA)!.laborCents).toBe(3000);
    const filtered = await as(a.actor, (s) => profitability(s, { by: "project", from: "2026-11-01" }));
    expect(filtered.find((r) => r.id === projectId)).toBeUndefined();
  });

  it("designer e atendimento não acessam o financeiro", async () => {
    const designer = await addMember(a.org.slug, a.org.id, "designer");
    const account = await addMember(a.org.slug, a.org.id, "account");
    await expect(as(designer, (s) => listInvoices(s, {}))).rejects.toThrow(/permissão/i);
    await expect(as(account, (s) => listInvoices(s, {}))).rejects.toThrow(/permissão/i);
    await expect(as(account, (s) => profitability(s, {}))).rejects.toThrow(/permissão/i);
    const finance = await addMember(a.org.slug, a.org.id, "finance");
    const list = await as(finance, (s) => listInvoices(s, {}));
    expect(list.total).toBeGreaterThan(0);
  });
});

describe("relatórios e painel inicial", () => {
  it("calculam indicadores com filtro de cliente e para ator com escopo restrito", async () => {
    const { buildReport, exportPage, resolvePeriod } = await import("@/server/services/reports");
    const { getDashboard } = await import("@/server/services/dashboard");
    await resetDb();
    const ctx = await createOrgWithOwner("Agência Relatórios");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente R" }))).id;
    const projectId = (
      await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto R", dueDate: "2026-01-05" }))
    ).id;
    const status = await as(ctx.actor, (s) => getDefaultStatus(s, "task"));
    await withOrg(ctx.org.id, (tx) =>
      tx.insert(tasks).values([
        {
          organizationId: ctx.org.id,
          projectId,
          title: "Feita no prazo",
          statusId: status.id,
          dueDate: "2026-10-10",
          completedAt: new Date("2026-10-08T15:00:00Z"),
        },
        {
          organizationId: ctx.org.id,
          projectId,
          title: "Feita atrasada",
          statusId: status.id,
          dueDate: "2026-10-01",
          completedAt: new Date("2026-10-08T15:00:00Z"),
        },
        {
          organizationId: ctx.org.id,
          projectId,
          title: "Atrasada aberta",
          statusId: status.id,
          dueDate: "2026-01-01",
          assigneeMembershipId: ctx.actor.membershipId,
          estimateMinutes: 120,
        },
      ]),
    );
    const report = await as(ctx.actor, (s) => buildReport(s, { from: "2026-09-01", to: "2026-10-31", clientId }));
    expect(report.tasks.completed).toBe(2);
    expect(report.tasks.onTimeRate).toBe(0.5);
    expect(report.tasks.overdueOpen).toBe(1);
    expect(report.weekly).toHaveLength(8);
    expect(report.weekly.reduce((a, w) => a + w.completed, 0)).toBe(2);
    expect(report.team.find((m) => m.membershipId === ctx.actor.membershipId)?.upcomingMinutes).toBe(120);
    expect(report.ai).not.toBeNull();

    const collaborator = await addMember(ctx.org.slug, ctx.org.id, "collaborator");
    await expect(as(collaborator, (s) => buildReport(s, {}))).rejects.toThrow(/permissão/i);
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    const designerReport = await as(designer, (s) => buildReport(s, { clientId }));
    expect(designerReport.ai).toBeNull(); // sem ai.settings
    await expect(as(designer, (s) => exportPage(s, "tasks", resolvePeriod({}), 0, 10))).rejects.toThrow(/permissão/i);
    const csv = await as(ctx.actor, (s) =>
      exportPage(s, "tasks", resolvePeriod({ from: "2026-09-01", to: "2026-10-31" }), 0, 10),
    );
    expect(csv.rows).toHaveLength(2);

    const dash = await as(ctx.actor, (s) => getDashboard(s));
    expect(dash.tasks.overdue.map((t) => t.title)).toEqual(["Atrasada aberta"]);
    expect(dash.projectsAtRisk.map((p) => p.id)).toContain(projectId);
    expect(dash.kpis?.overdueTasks).toBe(1);
    const collabDash = await as(collaborator, (s) => getDashboard(s));
    expect(collabDash.projectsAtRisk).toHaveLength(0);
    expect(collabDash.kpis).toBeNull();
  });
});
