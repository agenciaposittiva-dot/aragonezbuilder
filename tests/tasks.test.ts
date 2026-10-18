import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { memberships, tasks } from "@/server/db/schema";
import { createClient } from "@/server/services/clients";
import { createProject, setProjectMembers } from "@/server/services/projects";
import {
  addDependency,
  changeTaskStatus,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  taskIndicators,
  toggleTaskDone,
  updateTask,
} from "@/server/services/tasks";
import { addTimeEntry, getRunningTimer, startTimer, stopTimer } from "@/server/services/time-entries";
import { listStatuses } from "@/server/services/workflow";
import { todayISO } from "@/lib/format";
import { parseDuration } from "@/lib/validators/tasks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("tarefas", () => {
  let ctx: Ctx;
  let projectId: string;
  let clientId: string;
  let status: Record<string, string>;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Tarefas");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto" }))).id;
    const statuses = await as(ctx.actor, (s) => listStatuses(s, "task"));
    status = Object.fromEntries(statuses.map((st) => [st.key, st.id]));
  });

  it("cria tarefa no status padrão e emite eventos", async () => {
    const { id } = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Criar post", assigneeMembershipId: ctx.actor.membershipId }),
    );
    const t = await as(ctx.actor, (s) => getTask(s, id));
    expect(t.status.key).toBe("todo");
    expect(t.task.assigneeMembershipId).toBe(ctx.actor.membershipId);
  });

  it("quem não tem tasks.assign só pode atribuir a si mesmo", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    const other = await addMember(ctx.org.slug, ctx.org.id, "copywriter");
    await expect(
      as(designer, (s) =>
        createTask(s, { projectId, title: "Para outra pessoa", assigneeMembershipId: other.membershipId }),
      ),
    ).rejects.toThrow(/permissão para atribuir/i);
    const own = await as(designer, (s) =>
      createTask(s, { projectId, title: "Para mim", assigneeMembershipId: designer.membershipId }),
    );
    await expect(
      as(designer, (s) => updateTask(s, { id: own.id, assigneeMembershipId: other.membershipId })),
    ).rejects.toThrow(/permissão para atribuir/i);
  });

  it("posiciona cartões entre vizinhos no Kanban", async () => {
    const a = await as(ctx.actor, (s) => createTask(s, { projectId, title: "A", statusId: status.doing }));
    const b = await as(ctx.actor, (s) => createTask(s, { projectId, title: "B", statusId: status.doing }));
    const c = await as(ctx.actor, (s) => createTask(s, { projectId, title: "C", statusId: status.backlog }));
    // move C para entre A e B na coluna "Em produção"
    await as(ctx.actor, (s) => moveTask(s, { id: c.id, statusId: status.doing!, beforeId: a.id, afterId: b.id }));
    const list = await as(ctx.actor, (s) => listTasks(s, { projectId, statusId: status.doing, view: "board" }));
    expect(list.rows.map((r) => r.title)).toEqual(["A", "C", "B"]);
    // move B para o topo
    await as(ctx.actor, (s) => moveTask(s, { id: b.id, statusId: status.doing!, beforeId: null, afterId: a.id }));
    const again = await as(ctx.actor, (s) => listTasks(s, { projectId, statusId: status.doing, view: "board" }));
    expect(again.rows.map((r) => r.title)).toEqual(["B", "A", "C"]);
  });

  it("renumera posições quando o espaço entre cartões acaba", async () => {
    const x = await as(ctx.actor, (s) => createTask(s, { projectId, title: "X", statusId: status.internal_review }));
    const y = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Y", statusId: status.internal_review }));
    await withOrg(ctx.org.id, async (tx) => {
      await tx.update(tasks).set({ position: 10 }).where(eq(tasks.id, x.id));
      await tx
        .update(tasks)
        .set({ position: 10 + 1e-9 })
        .where(eq(tasks.id, y.id));
    });
    const z = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Z", statusId: status.backlog }));
    await as(ctx.actor, (s) =>
      moveTask(s, { id: z.id, statusId: status.internal_review!, beforeId: x.id, afterId: y.id }),
    );
    const list = await as(ctx.actor, (s) =>
      listTasks(s, { projectId, statusId: status.internal_review, view: "board" }),
    );
    expect(list.rows.map((r) => r.title)).toEqual(["X", "Z", "Y"]);
  });

  it("conclusão registra completedAt e reabertura limpa", async () => {
    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Concluir" }));
    await as(ctx.actor, (s) => toggleTaskDone(s, t.id, true));
    const done = await as(ctx.actor, (s) => getTask(s, t.id));
    expect(done.task.completedAt).not.toBeNull();
    expect(done.status.category).toBe("done");
    await as(ctx.actor, (s) => toggleTaskDone(s, t.id, false));
    const reopened = await as(ctx.actor, (s) => getTask(s, t.id));
    expect(reopened.task.completedAt).toBeNull();
  });

  it("respeita as transições configuradas", async () => {
    const { setTransitions } = await import("@/server/services/workflow");
    // a partir de "Backlog" só é permitido ir para "A fazer"
    await as(ctx.actor, (s) => setTransitions(s, status.backlog!, [status.todo!]));
    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Fluxo", statusId: status.backlog }));
    await expect(as(ctx.actor, (s) => changeTaskStatus(s, t.id, status.done!))).rejects.toThrow(/não permitida/i);
    await as(ctx.actor, (s) => changeTaskStatus(s, t.id, status.todo!));
    await as(ctx.actor, (s) => setTransitions(s, status.backlog!, []));
  });

  it("dependência pendente impede a conclusão e ciclos são recusados", async () => {
    const first = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Roteiro" }));
    const second = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Gravação" }));
    const third = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Edição" }));
    await as(ctx.actor, (s) => addDependency(s, second.id, first.id));
    await as(ctx.actor, (s) => addDependency(s, third.id, second.id));
    await expect(as(ctx.actor, (s) => toggleTaskDone(s, second.id, true))).rejects.toThrow(/Conclua antes/i);
    await expect(as(ctx.actor, (s) => addDependency(s, first.id, third.id))).rejects.toThrow(/ciclo/i);
    await expect(as(ctx.actor, (s) => addDependency(s, first.id, first.id))).rejects.toThrow(/si mesma/i);
    await as(ctx.actor, (s) => toggleTaskDone(s, first.id, true));
    await as(ctx.actor, (s) => toggleTaskDone(s, second.id, true));
    const t = await as(ctx.actor, (s) => getTask(s, second.id));
    expect(t.task.completedAt).not.toBeNull();
  });

  it("congela o custo do tempo registrado com o custo/hora do momento", async () => {
    await withOrg(ctx.org.id, (tx) =>
      tx.update(memberships).set({ hourlyCostCents: 6000 }).where(eq(memberships.id, ctx.actor.membershipId)),
    );
    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Com horas" }));
    await as(ctx.actor, (s) => addTimeEntry(s, { taskId: t.id, date: "2026-10-10", minutes: 90 }));
    await withOrg(ctx.org.id, (tx) =>
      tx.update(memberships).set({ hourlyCostCents: 12000 }).where(eq(memberships.id, ctx.actor.membershipId)),
    );
    const { listTimeEntries } = await import("@/server/services/time-entries");
    const entries = await as(ctx.actor, (s) => listTimeEntries(s, t.id));
    expect(entries[0]?.minutes).toBe(90);
    expect(entries[0]?.costCents).toBe(9000);
  });

  it("mantém no máximo um cronômetro por pessoa", async () => {
    const t1 = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Timer 1" }));
    const t2 = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Timer 2" }));
    await as(ctx.actor, (s) => startTimer(s, t1.id));
    await as(ctx.actor, (s) => startTimer(s, t2.id));
    const running = await as(ctx.actor, (s) => getRunningTimer(s));
    expect(running?.taskId).toBe(t2.id);
    const stopped = await as(ctx.actor, (s) => stopTimer(s));
    expect(stopped.minutes).toBeGreaterThanOrEqual(1);
    expect(await as(ctx.actor, (s) => getRunningTimer(s))).toBeNull();
  });

  it("indicadores e filtros de prazo/bloqueio batem com as tarefas reais", async () => {
    const today = todayISO();
    const past = new Date(Date.parse(`${today}T12:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
    const before = await as(ctx.actor, (s) => taskIndicators(s));
    const me = ctx.actor.membershipId;
    const late = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Vencida", dueDate: past, assigneeMembershipId: me }),
    );
    const now = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Hoje", dueDate: today, assigneeMembershipId: me }),
    );
    const waiting = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Esperando" }));
    await as(ctx.actor, (s) => addDependency(s, waiting.id, now.id));
    const after = await as(ctx.actor, (s) => taskIndicators(s));
    expect(after.overdue - before.overdue).toBe(1);
    expect(after.today - before.today).toBe(1);
    expect(after.blocked - before.blocked).toBe(1);
    expect(after.unassigned - before.unassigned).toBe(1);
    expect(after.mine - before.mine).toBe(2);

    const ids = async (p: Parameters<typeof listTasks>[1]) =>
      (await as(ctx.actor, (s) => listTasks(s, p))).rows.map((r) => r.id);
    expect(await ids({ due: "overdue" })).toContain(late.id);
    expect(await ids({ due: "overdue" })).not.toContain(now.id);
    expect(await ids({ due: "today" })).toEqual(expect.arrayContaining([now.id]));
    expect(await ids({ blocked: true })).toEqual([waiting.id]);
    const focus = await ids({ assignee: "me", open: true, sort: "focus" });
    expect(focus.indexOf(late.id)).toBeLessThan(focus.indexOf(now.id));

    await as(ctx.actor, (s) => toggleTaskDone(s, now.id, true));
    expect(await ids({ blocked: true })).toEqual([]);
    expect(await ids({ completedSince: today })).toContain(now.id);
    expect((await as(ctx.actor, (s) => taskIndicators(s))).doneWeek - after.doneWeek).toBe(1);
  });

  it("usuário de cliente não vê tarefas", async () => {
    const clientUser = await addMember(ctx.org.slug, ctx.org.id, "client", { clientIds: [clientId] });
    await expect(as(clientUser, (s) => listTasks(s, {}))).rejects.toThrow(/permissão/i);
    const any = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Interna" }));
    await expect(as(clientUser, (s) => getTask(s, any.id))).rejects.toThrow();
  });

  it("colaborador só vê tarefas de projetos em que participa", async () => {
    const collaborator = await addMember(ctx.org.slug, ctx.org.id, "collaborator");
    const before = await as(collaborator, (s) => listTasks(s, {}));
    expect(before.rows).toHaveLength(0);
    await as(ctx.actor, (s) => setProjectMembers(s, { projectId, membershipIds: [collaborator.membershipId] }));
    const after = await as(collaborator, (s) => listTasks(s, {}));
    expect(after.rows.length).toBeGreaterThan(0);
  });

  it("exclusão exige permissão e remove a tarefa", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Excluir" }));
    await expect(as(designer, (s) => deleteTask(s, t.id))).rejects.toThrow(/permissão/i);
    await as(ctx.actor, (s) => deleteTask(s, t.id));
    await expect(as(ctx.actor, (s) => getTask(s, t.id))).rejects.toThrow(/não encontrada/i);
  });
});

describe("parseDuration", () => {
  it("entende os formatos comuns", () => {
    expect(parseDuration("1h15")).toBe(75);
    expect(parseDuration("1h30min")).toBe(90);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1,5h")).toBe(90);
    expect(parseDuration("45min")).toBe(45);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration(" 1h 15 ")).toBe(75);
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});
