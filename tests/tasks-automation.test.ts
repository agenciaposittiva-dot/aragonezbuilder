import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTOMATION_PRESETS } from "@/lib/automation-presets";
import type { Actor } from "@/server/authz";
import { withOrg } from "@/server/db";
import { automationRules, automationRuns, domainEvents, notifications, tasks } from "@/server/db/schema";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { scanDueSoonTasks } from "@/server/events/schedules";
import { ValidationError } from "@/server/errors";
import { approvalTaskOptions, decideApproval, requestApproval } from "@/server/services/approvals";
import { saveRule } from "@/server/services/automations";
import { createClient } from "@/server/services/clients";
import { storeUpload } from "@/server/services/files";
import { createProject } from "@/server/services/projects";
import { addDependency, createTask, getTask, toggleTaskDone, updateTask } from "@/server/services/tasks";
import { listStatuses } from "@/server/services/workflow";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

function iso(offset: number) {
  const d = new Date(
    `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())}T12:00:00Z`,
  );
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

describe("central de tarefas: automações e integrações", () => {
  let ctx: Ctx;
  let designer: Actor;
  let clientId: string;
  let projectId: string;
  let otherProjectId: string;
  let statusByKey: Record<string, string>;

  const runsOf = (ruleId: string) =>
    withOrg(ctx.org.id, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.ruleId, ruleId)));
  const notesOf = (userId: string) =>
    withOrg(ctx.org.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
  const presetRule = (key: string) => structuredClone(AUTOMATION_PRESETS.find((p) => p.key === key)!.rule);

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Automática");
    designer = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Duda Designer" });
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Auto" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Auto" }))).id;
    otherProjectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Outro projeto" }))).id;
    statusByKey = Object.fromEntries(
      (await as(ctx.actor, (s) => listStatuses(s, "task"))).map((st) => [st.key, st.id]),
    );
    await dispatchPendingEvents(500);
  });

  beforeEach(async () => {
    // Cada caso começa sem regras ativas.
    await withOrg(ctx.org.id, (tx) =>
      tx.update(automationRules).set({ enabled: false }).where(eq(automationRules.organizationId, ctx.org.id)),
    );
  });

  it("responsável padrão: atribui só tarefas sem responsável, com histórico e sem laço", async () => {
    const rule = presetRule("task-default-assignee");
    // O modelo exige escolher a pessoa antes de salvar.
    await expect(as(ctx.actor, (s) => saveRule(s, rule))).rejects.toBeInstanceOf(Error);
    rule.actions = [{ type: "assign_task", membershipId: designer.membershipId, onlyIfUnassigned: true }];
    rule.conditions = [{ field: "projectId", op: "eq", value: projectId }];
    const saved = await as(ctx.actor, (s) => saveRule(s, rule));

    const free = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Sem dono" }));
    const owned = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Com dono", assigneeMembershipId: ctx.actor.membershipId }),
    );
    const elsewhere = await as(ctx.actor, (s) => createTask(s, { projectId: otherProjectId, title: "Outro" }));
    await dispatchPendingEvents(200);
    // Os eventos gerados pela automação entram na fila e são processados na rodada seguinte.
    await dispatchPendingEvents(200);

    expect((await as(ctx.actor, (s) => getTask(s, free.id))).task.assigneeMembershipId).toBe(designer.membershipId);
    expect((await as(ctx.actor, (s) => getTask(s, owned.id))).task.assigneeMembershipId).toBe(ctx.actor.membershipId);
    expect((await as(ctx.actor, (s) => getTask(s, elsewhere.id))).task.assigneeMembershipId).toBeNull();

    const runs = await runsOf(saved.id);
    expect(runs.filter((r) => r.status === "success")).toHaveLength(2);
    expect(runs.filter((r) => r.status === "skipped")).toHaveLength(1);
    const skippedAction = runs
      .map((r) => (r.result as { actions?: { skipped?: string }[] })?.actions?.[0]?.skipped)
      .filter(Boolean);
    expect(skippedAction).toEqual(["A tarefa já tem responsável."]);
    // O "task.assigned" gerado pela automação avisa a pessoa, mas não dispara outras automações.
    const assigned = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, "task.assigned"), eq(domainEvents.entityId, free.id))),
    );
    expect((assigned[0]?.payload as { viaAutomation?: string }).viaAutomation).toBe(saved.id);
    expect((await notesOf(designer.userId)).some((n) => n.title === "Nova tarefa atribuída a você")).toBe(true);
  });

  it("concluir uma etapa libera a dependente: aviso e regra para mover a próxima", async () => {
    const saved = await as(ctx.actor, (s) => saveRule(s, presetRule("task-unblocked-todo")));
    const a = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Roteiro aprovado" }));
    const c = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Locução" }));
    const b = await as(ctx.actor, (s) =>
      createTask(s, {
        projectId,
        title: "Gravação",
        statusId: statusByKey.backlog,
        assigneeMembershipId: designer.membershipId,
      }),
    );
    await as(ctx.actor, (s) => addDependency(s, b.id, a.id));
    await as(ctx.actor, (s) => addDependency(s, b.id, c.id));
    await dispatchPendingEvents(200);

    // Ainda falta "Locução": nada é liberado.
    await as(ctx.actor, (s) => toggleTaskDone(s, a.id, true));
    await dispatchPendingEvents(200);
    expect((await as(ctx.actor, (s) => getTask(s, b.id))).status.key).toBe("backlog");

    await as(ctx.actor, (s) => toggleTaskDone(s, c.id, true));
    await dispatchPendingEvents(200);
    const after = await as(ctx.actor, (s) => getTask(s, b.id));
    expect(after.status.key).toBe("todo");
    const note = (await notesOf(designer.userId)).find((n) => n.title === "Tarefa liberada: Gravação");
    expect(note?.body).toContain("Locução");
    expect((await runsOf(saved.id)).map((r) => r.status)).toEqual(["success"]);
  });

  it("automação não conclui tarefa com dependências abertas (erro registrado no histórico)", async () => {
    const rule = await as(ctx.actor, (s) =>
      saveRule(s, {
        name: "Concluir ao mudar prazo",
        trigger: "task.due_changed",
        conditions: [],
        actions: [{ type: "set_task_status", statusKey: "done" }],
        enabled: true,
      }),
    );
    const base = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Base aberta" }));
    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Depende" }));
    await as(ctx.actor, (s) => addDependency(s, t.id, base.id));
    await as(ctx.actor, (s) => updateTask(s, { id: t.id, dueDate: iso(10) }));
    await dispatchPendingEvents(200);
    const [run] = await runsOf(rule.id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Base aberta");
    expect((await as(ctx.actor, (s) => getTask(s, t.id))).task.completedAt).toBeNull();
  });

  it("prazo próximo: aviso diário sem duplicidade e novo aviso se o prazo mudar", async () => {
    const mk = (title: string, due: string | null) =>
      as(ctx.actor, (s) =>
        createTask(s, { projectId, title, dueDate: due, assigneeMembershipId: designer.membershipId }),
      );
    const today = await mk("Vence hoje", iso(0));
    const tomorrow = await mk("Vence amanhã", iso(1));
    const two = await mk("Vence em 2", iso(2));
    const far = await mk("Vence em 5", iso(5));
    const late = await mk("Atrasada", iso(-1));
    const done = await mk("Concluída", iso(1));
    await as(ctx.actor, (s) => toggleTaskDone(s, done.id, true));
    const ids = [today.id, tomorrow.id, two.id, far.id, late.id, done.id];
    const events = () =>
      withOrg(ctx.org.id, (tx) =>
        tx
          .select()
          .from(domainEvents)
          .where(and(eq(domainEvents.type, "task.due_soon"), inArray(domainEvents.entityId, ids))),
      );

    await scanDueSoonTasks();
    await scanDueSoonTasks();
    const first = await events();
    expect(first.map((e) => e.entityId).sort()).toEqual([today.id, tomorrow.id, two.id].sort());
    expect((first.find((e) => e.entityId === tomorrow.id)?.payload as { daysLeft: number }).daysLeft).toBe(1);

    await as(ctx.actor, (s) => updateTask(s, { id: two.id, dueDate: iso(1) }));
    await scanDueSoonTasks();
    expect((await events()).filter((e) => e.entityId === two.id)).toHaveLength(2);

    await dispatchPendingEvents(300);
    const notes = await notesOf(designer.userId);
    expect(notes.find((n) => n.title === "Prazo próximo: Vence amanhã")?.body).toMatch(/^Vence amanhã \(/);
    expect(notes.find((n) => n.title === "Prazo próximo: Vence hoje")?.body).toMatch(/^Vence hoje/);
  });

  it("aprovação vinculada à tarefa: revisão, aprovação do cliente conclui pela regra", async () => {
    const saved = await as(ctx.actor, (s) => saveRule(s, presetRule("approved-task-done")));
    const task = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Arte do post" }));
    const foreign = await as(ctx.actor, (s) => createTask(s, { projectId: otherProjectId, title: "Outra" }));
    const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();
    const file = await as(ctx.actor, (s) =>
      storeUpload(s, { buffer: png, originalName: "arte.png" }, { clientId, projectId }),
    );

    const opts = await as(ctx.actor, (s) => approvalTaskOptions(s, file.fileId));
    expect(opts.tasks.map((t) => t.id)).toContain(task.id);
    expect(opts.tasks.map((t) => t.id)).not.toContain(foreign.id);
    await expect(
      as(ctx.actor, (s) => requestApproval(s, { fileId: file.fileId, stage: "internal", taskId: foreign.id })),
    ).rejects.toBeInstanceOf(ValidationError);

    const internal = await as(ctx.actor, (s) =>
      requestApproval(s, { fileId: file.fileId, stage: "internal", taskId: task.id, moveTaskToReview: true }),
    );
    expect((await as(ctx.actor, (s) => getTask(s, task.id))).status.key).toBe("internal_review");
    await as(ctx.actor, (s) => decideApproval(s, { approvalId: internal.id, decision: "approved" }));
    const client = await as(ctx.actor, (s) =>
      requestApproval(s, { fileId: file.fileId, stage: "client", taskId: task.id, moveTaskToReview: true }),
    );
    expect((await as(ctx.actor, (s) => getTask(s, task.id))).status.key).toBe("client_review");

    const clientUser = await addMember(ctx.org.slug, ctx.org.id, "client_approver", { clientIds: [clientId] });
    await as(clientUser, (s) => decideApproval(s, { approvalId: client.id, decision: "approved" }));
    await dispatchPendingEvents(200);
    const final = await as(ctx.actor, (s) => getTask(s, task.id));
    expect(final.status.key).toBe("done");
    expect(final.task.completedAt).not.toBeNull();
    // A decisão interna não atende às condições (etapa do cliente): fica registrada como ignorada.
    expect((await runsOf(saved.id)).map((r) => r.status).sort()).toEqual(["skipped", "success"]);
    // Sem a opção marcada, o status não muda.
    const t2 = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Sem mover" }));
    const f2 = await as(ctx.actor, (s) =>
      storeUpload(s, { buffer: png, originalName: "outra.png" }, { clientId, projectId }),
    );
    await as(ctx.actor, (s) => requestApproval(s, { fileId: f2.fileId, stage: "internal", taskId: t2.id }));
    expect((await as(ctx.actor, (s) => getTask(s, t2.id))).status.key).toBe("todo");
    const linked = await withOrg(ctx.org.id, (tx) => tx.select().from(tasks).where(eq(tasks.id, t2.id)));
    expect(linked).toHaveLength(1);
  });
});
