import { beforeAll, describe, expect, it } from "vitest";
import { todayISO } from "@/lib/format";
import { ForbiddenError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { demandIndicators, listDemands, resolveDemandOwner } from "@/server/services/demands";
import { getShellCounts } from "@/server/services/shell";
import { createProject } from "@/server/services/projects";
import { createTask, toggleTaskDone, updateTask } from "@/server/services/tasks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

function plusDays(days: number) {
  const d = new Date(`${todayISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("minhas demandas", () => {
  let ctx: Ctx;
  let projectId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Demandas");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Demandas" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Demandas" }))).id;
  });

  it("indicadores reais: atrasadas, hoje, próximos 7 dias (sem hoje) e todas abertas", async () => {
    const me = ctx.actor.membershipId;
    const mk = (title: string, dueDate: string | null) =>
      as(ctx.actor, (s) => createTask(s, { projectId, title, dueDate, assigneeMembershipId: me }));
    await mk("Atrasada", plusDays(-2));
    await mk("Hoje", plusDays(0));
    await mk("Amanhã", plusDays(1));
    await mk("Daqui a 7 dias", plusDays(7));
    await mk("Daqui a 8 dias", plusDays(8));
    await mk("Sem prazo", null);
    const done = await mk("Concluída hoje", plusDays(0));
    await as(ctx.actor, (s) => toggleTaskDone(s, done.id, true));
    // Atribuída a outra pessoa: não é minha demanda.
    const other = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Outra pessoa" });
    await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Da outra pessoa", dueDate: plusDays(0), assigneeMembershipId: other.membershipId }),
    );

    const ind = await as(ctx.actor, (s) => demandIndicators(s, me));
    expect(ind).toEqual({ overdue: 1, today: 1, week: 2, open: 6 });

    const titles = async (filter: "abertas" | "atrasadas" | "hoje" | "semana") =>
      (await as(ctx.actor, (s) => listDemands(s, { membershipId: me, filter }))).map((r) => r.title).sort();
    expect(await titles("atrasadas")).toEqual(["Atrasada"]);
    expect(await titles("hoje")).toEqual(["Hoje"]);
    expect(await titles("semana")).toEqual(["Amanhã", "Daqui a 7 dias"]);
    expect(await titles("abertas")).toHaveLength(6);
    // Contador do menu: atrasadas + hoje.
    expect((await as(ctx.actor, getShellCounts)).badges.demands).toBe(2);
  });

  it("mudar o prazo na tarefa reflete nos indicadores (mesmo registro)", async () => {
    const me = ctx.actor.membershipId;
    const t = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Reagendar", dueDate: plusDays(3), assigneeMembershipId: me }),
    );
    const before = await as(ctx.actor, (s) => demandIndicators(s, me));
    await as(ctx.actor, (s) => updateTask(s, { id: t.id, dueDate: plusDays(-1) }));
    const after = await as(ctx.actor, (s) => demandIndicators(s, me));
    expect(after.overdue).toBe(before.overdue + 1);
    expect(after.week).toBe(before.week - 1);
    expect(after.open).toBe(before.open);
  });

  it("subtarefas atribuídas à pessoa contam; busca filtra pelo título", async () => {
    const me = ctx.actor.membershipId;
    const parent = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Campanha mãe" }));
    await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Subtarefa minha", parentTaskId: parent.id, assigneeMembershipId: me }),
    );
    const rows = await as(ctx.actor, (s) => listDemands(s, { membershipId: me, q: "subtarefa" }));
    expect(rows.map((r) => r.title)).toEqual(["Subtarefa minha"]);
  });

  it("'Ver como' outra pessoa só para quem distribui tarefas", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Designer" });
    expect(await as(ctx.actor, (s) => resolveDemandOwner(s, designer.membershipId))).toBe(designer.membershipId);
    await expect(as(designer, (s) => resolveDemandOwner(s, ctx.actor.membershipId))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await as(designer, (s) => resolveDemandOwner(s, null))).toBe(designer.membershipId);
  });
});
