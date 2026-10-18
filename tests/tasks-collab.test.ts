import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/server/db";
import { notifications, tasks } from "@/server/db/schema";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { addComment, listComments, taskMentionables } from "@/server/services/comments";
import { createProject } from "@/server/services/projects";
import {
  createTask,
  deleteTask,
  duplicateTask,
  getTask,
  listTasks,
  saveChecklistItem,
  setTaskArchived,
  toggleChecklistItem,
  updateTask,
} from "@/server/services/tasks";
import { listTrash, purgeExpiredTrash, purgeFromTrash, restoreFromTrash } from "@/server/services/trash";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

async function notificationsOf(userId: string) {
  return withSystem((tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
}

describe("central de tarefas: colaboração, duplicação e lixeira", () => {
  let ctx: Ctx;
  let other: Ctx;
  let projectId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Colab");
    other = await createOrgWithOwner("Agência Vizinha");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Colab" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Colab" }))).id;
  });

  it("duplica com checklist desmarcado e, se pedido, com subtarefas", async () => {
    const t = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Post de lançamento", priority: "high", dueDate: "2030-01-10" }),
    );
    const item = await as(ctx.actor, (s) => saveChecklistItem(s, { taskId: t.id, title: "Revisar legenda" }));
    await as(ctx.actor, (s) => toggleChecklistItem(s, t.id, item.id, true));
    await as(ctx.actor, (s) => createTask(s, { projectId, parentTaskId: t.id, title: "Copy" }));

    const simple = await as(ctx.actor, (s) => duplicateTask(s, t.id));
    const copy = await as(ctx.actor, (s) => getTask(s, simple.id));
    expect(copy.task.title).toBe("Post de lançamento (cópia)");
    expect(copy.task.priority).toBe("high");
    expect(copy.task.dueDate).toBe("2030-01-10");
    expect(copy.checklist.map((c) => [c.title, c.done])).toEqual([["Revisar legenda", false]]);
    expect(copy.subtasks).toHaveLength(0);

    const full = await as(ctx.actor, (s) => duplicateTask(s, t.id, { withSubtasks: true }));
    expect((await as(ctx.actor, (s) => getTask(s, full.id))).subtasks.map((st) => st.title)).toEqual(["Copy"]);
  });

  it("avisa responsável e colaboradores quando o prazo muda", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Dani Designer" });
    const t = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Banner", dueDate: "2030-02-01", assigneeMembershipId: designer.membershipId }),
    );
    await dispatchPendingEvents(200);
    await as(ctx.actor, (s) => updateTask(s, { id: t.id, dueDate: "2030-02-05" }));
    await dispatchPendingEvents(200);
    const mine = await notificationsOf(designer.userId);
    const changed = mine.find((n) => n.type === "task.due_changed");
    expect(changed?.title).toBe("Prazo alterado: Banner");
    expect(changed?.body).toBe("De 01/02/2030 para 05/02/2030.");
    // Quem alterou não é notificado.
    expect((await notificationsOf(ctx.owner.id)).some((n) => n.type === "task.due_changed")).toBe(false);
  });

  it("menções: só quem tem acesso à tarefa, com aviso próprio", async () => {
    const manager = await addMember(ctx.org.slug, ctx.org.id, "manager", { name: "Gabi Gestora" });
    // Colaborador sem acesso a todos os dados e fora do projeto.
    const outsider = await addMember(ctx.org.slug, ctx.org.id, "collaborator", { name: "Ola Externa" });
    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Roteiro do vídeo" }));

    const options = await as(ctx.actor, (s) => taskMentionables(s, t.id));
    expect(options.map((o) => o.name)).toContain("Gabi Gestora");
    expect(options.map((o) => o.name)).not.toContain("Ola Externa");

    await expect(
      as(ctx.actor, (s) =>
        addComment(s, { target: { taskId: t.id }, body: "@Ola Externa veja", mentions: [outsider.membershipId] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      as(ctx.actor, (s) => addComment(s, { target: { projectId }, body: "@Gabi", mentions: [manager.membershipId] })),
    ).rejects.toBeInstanceOf(ValidationError);
    // Vínculo de outra agência também é recusado.
    await expect(
      as(ctx.actor, (s) =>
        addComment(s, { target: { taskId: t.id }, body: "@x", mentions: [other.actor.membershipId] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await as(ctx.actor, (s) =>
      addComment(s, {
        target: { taskId: t.id },
        body: "@Gabi Gestora pode revisar hoje?",
        mentions: [manager.membershipId],
      }),
    );
    const [comment] = await as(ctx.actor, (s) => listComments(s, { taskId: t.id }));
    expect(comment?.mentionedMembershipIds).toEqual([manager.membershipId]);
    await dispatchPendingEvents(200);
    const mention = (await notificationsOf(manager.userId)).find((n) => n.title.includes("mencionou você"));
    expect(mention?.title).toBe(`${ctx.actor.name} mencionou você em "Roteiro do vídeo"`);
    expect(mention?.link).toBe(`/w/${ctx.org.slug}/tasks/${t.id}`);
  });

  it("excluir manda a tarefa e as subtarefas para a lixeira; restaurar devolve como estavam", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Campanha de inverno" }));
    const sub1 = await as(ctx.actor, (s) => createTask(s, { projectId, parentTaskId: t.id, title: "Arte 1" }));
    const sub2 = await as(ctx.actor, (s) => createTask(s, { projectId, parentTaskId: t.id, title: "Arte 2" }));
    // Subtarefa já arquivada antes: continua arquivada depois de restaurar.
    await as(ctx.actor, (s) => setTaskArchived(s, sub2.id, true));

    await expect(as(designer, (s) => deleteTask(s, t.id))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(other.actor, (s) => deleteTask(s, t.id))).rejects.toBeInstanceOf(NotFoundError);
    await as(ctx.actor, (s) => deleteTask(s, t.id));

    await expect(as(ctx.actor, (s) => getTask(s, t.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(ctx.actor, (s) => getTask(s, sub1.id))).rejects.toBeInstanceOf(NotFoundError);
    const listed = (await as(ctx.actor, (s) => listTasks(s, { subtasks: true }))).rows.map((r) => r.id);
    expect(listed).not.toContain(t.id);
    expect(listed).not.toContain(sub1.id);
    const archivedList = (await as(ctx.actor, (s) => listTasks(s, { archived: true, subtasks: true }))).rows;
    expect(archivedList.map((r) => r.id)).not.toContain(t.id);

    const trash = await as(ctx.actor, (s) => listTrash(s));
    expect(trash.find((i) => i.id === t.id)?.kind).toBe("task");
    // A subtarefa excluída junto aparece dentro da principal, não sozinha.
    expect(trash.some((i) => i.id === sub1.id)).toBe(false);
    await expect(as(ctx.actor, (s) => restoreFromTrash(s, "task", sub1.id))).rejects.toBeInstanceOf(ValidationError);

    await as(ctx.actor, (s) => restoreFromTrash(s, "task", t.id));
    const back = await as(ctx.actor, (s) => getTask(s, t.id));
    expect(back.task.archivedAt).toBeNull();
    expect(back.subtasks.map((st) => st.id)).toEqual([sub1.id]);
    const [rowSub2] = await withSystem((tx) => tx.select().from(tasks).where(eq(tasks.id, sub2.id)));
    expect(rowSub2?.deletedAt).toBeNull();
    expect(rowSub2?.archivedAt).not.toBeNull();
  });

  it("exclusão definitiva e prazo de 30 dias", async () => {
    const a = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Apagar já" }));
    const b = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Apagar depois" }));
    await as(ctx.actor, (s) => createTask(s, { projectId, parentTaskId: b.id, title: "Filha" }));
    await as(ctx.actor, (s) => deleteTask(s, a.id));
    await as(ctx.actor, (s) => deleteTask(s, b.id));
    await as(ctx.actor, (s) => purgeFromTrash(s, "task", a.id));
    const gone = await withSystem((tx) => tx.select().from(tasks).where(eq(tasks.id, a.id)));
    expect(gone).toHaveLength(0);

    let res = await purgeExpiredTrash(new Date(Date.now() + 29 * 86_400_000));
    expect(res.tasks).toBe(0);
    res = await purgeExpiredTrash(new Date(Date.now() + 31 * 86_400_000));
    expect(res.tasks).toBeGreaterThanOrEqual(1);
    const rest = await withSystem((tx) =>
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.organizationId, ctx.org.id), eq(tasks.title, "Filha"))),
    );
    expect(rest).toHaveLength(0);
  });
});
