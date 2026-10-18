import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg, withSystem } from "@/server/db";
import { approvals, domainEvents, emailOutbox, files, fileVersions, notifications, tasks } from "@/server/db/schema";
import { dispatchPendingEvents, processEvent } from "@/server/events/dispatcher";
import { createClient } from "@/server/services/clients";
import { createProject } from "@/server/services/projects";
import { getDefaultStatus } from "@/server/services/workflow";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

async function emit(
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
  actorUserId: string | null,
  entityType = "test",
  entityId?: string,
) {
  const [row] = await withOrg(orgId, (tx) =>
    tx
      .insert(domainEvents)
      .values({ organizationId: orgId, type, entityType, entityId: entityId ?? null, payload, actorUserId })
      .returning({ id: domainEvents.id }),
  );
  return row!.id;
}

async function notificationsFor(orgId: string, userId: string) {
  return withOrg(orgId, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
}

describe("notificações geradas pelo despachante de eventos", () => {
  let ctx: Ctx;
  let designer: Awaited<ReturnType<typeof addMember>>;
  let clientUser: Awaited<ReturnType<typeof addMember>>;
  let clientId: string;
  let projectId: string;
  let taskId: string;
  let fileId: string;
  let versionId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Avisos", "Dona");
    designer = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Diego Designer" });
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Avisado" }))).id;
    clientUser = await addMember(ctx.org.slug, ctx.org.id, "client", { name: "Carla Cliente", clientIds: [clientId] });
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Avisos" }))).id;
    const status = await as(ctx.actor, (s) => getDefaultStatus(s, "task"));
    [{ id: taskId }] = (await withOrg(ctx.org.id, (tx) =>
      tx
        .insert(tasks)
        .values({
          organizationId: ctx.org.id,
          projectId,
          title: "Criar post",
          statusId: status.id,
          assigneeMembershipId: designer.membershipId,
        })
        .returning({ id: tasks.id }),
    )) as [{ id: string }];
    const file = await withOrg(ctx.org.id, async (tx) => {
      const [f] = await tx
        .insert(files)
        .values({
          organizationId: ctx.org.id,
          clientId,
          projectId,
          taskId,
          name: "post-natal.png",
          sharedWithClient: true,
          createdByUserId: designer.userId,
        })
        .returning({ id: files.id });
      const [v] = await tx
        .insert(fileVersions)
        .values({
          organizationId: ctx.org.id,
          fileId: f!.id,
          versionNumber: 1,
          storageKey: "k",
          originalName: "post-natal.png",
          mimeType: "image/png",
          sizeBytes: 10,
        })
        .returning({ id: fileVersions.id });
      return { fileId: f!.id, versionId: v!.id };
    });
    fileId = file.fileId;
    versionId = file.versionId;
    await dispatchPendingEvents(200); // processa os eventos do cadastro
  });

  it("task.assigned notifica o responsável e nunca quem atribuiu", async () => {
    await emit(
      ctx.org.id,
      "task.assigned",
      { taskId, projectId, title: "Criar post", assigneeMembershipId: designer.membershipId },
      ctx.owner.id,
      "task",
      taskId,
    );
    await dispatchPendingEvents();
    const mine = await notificationsFor(ctx.org.id, designer.userId);
    const assigned = mine.filter((n) => n.type === "task.assigned");
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.link).toBe(`/w/${ctx.org.slug}/tasks/${taskId}`);
    const ownerNotes = await notificationsFor(ctx.org.id, ctx.owner.id);
    expect(ownerNotes.filter((n) => n.type === "task.assigned")).toHaveLength(0);
  });

  it("pedido de aprovação ao cliente notifica os usuários do cliente e enfileira e-mail", async () => {
    const [approval] = await withOrg(ctx.org.id, (tx) =>
      tx
        .insert(approvals)
        .values({
          organizationId: ctx.org.id,
          fileId,
          fileVersionId: versionId,
          taskId,
          stage: "client",
          requestedByUserId: designer.userId,
        })
        .returning({ id: approvals.id }),
    );
    await emit(
      ctx.org.id,
      "approval.requested",
      {
        approvalId: approval!.id,
        fileId,
        versionId,
        stage: "client",
        clientId,
        projectId,
        taskId,
        fileName: "post-natal.png",
      },
      designer.userId,
      "approval",
      approval!.id,
    );
    await dispatchPendingEvents();
    const clientNotes = (await notificationsFor(ctx.org.id, clientUser.userId)).filter(
      (n) => n.type === "approval.requested",
    );
    expect(clientNotes).toHaveLength(1);
    expect(clientNotes[0]!.link).toBe(`/portal/${ctx.org.slug}/ir/approvals`);
    const mails = await withSystem((tx) => tx.select().from(emailOutbox).where(eq(emailOutbox.to, clientUser.email)));
    expect(mails.length).toBeGreaterThanOrEqual(1);
    expect(mails[0]!.text).toContain(`/portal/${ctx.org.slug}/ir/approvals`);
  });

  it("comentário interno nunca notifica o cliente; comentário visível da equipe notifica", async () => {
    await emit(
      ctx.org.id,
      "comment.created",
      {
        commentId: "00000000-0000-0000-0000-000000000001",
        target: { type: "file", id: fileId },
        internal: true,
        authorKind: "internal",
        excerpt: "nota interna",
      },
      designer.userId,
      "file",
      fileId,
    );
    await dispatchPendingEvents();
    let clientComments = (await notificationsFor(ctx.org.id, clientUser.userId)).filter(
      (n) => n.type === "comment.created",
    );
    expect(clientComments).toHaveLength(0);
    // a equipe (dona do projeto) é notificada do comentário interno
    const ownerComments = (await notificationsFor(ctx.org.id, ctx.owner.id)).filter(
      (n) => n.type === "comment.created",
    );
    expect(ownerComments).toHaveLength(1);

    await emit(
      ctx.org.id,
      "comment.created",
      {
        commentId: "00000000-0000-0000-0000-000000000002",
        target: { type: "file", id: fileId },
        internal: false,
        authorKind: "internal",
        excerpt: "versão nova no ar",
      },
      designer.userId,
      "file",
      fileId,
    );
    await dispatchPendingEvents();
    clientComments = (await notificationsFor(ctx.org.id, clientUser.userId)).filter(
      (n) => n.type === "comment.created",
    );
    expect(clientComments).toHaveLength(1);
    expect(clientComments[0]!.link).toBe(`/portal/${ctx.org.slug}/ir/files/${fileId}`);
  });

  it("comentário interno em tarefa não chega ao cliente mesmo se marcado como visível", async () => {
    await emit(
      ctx.org.id,
      "comment.created",
      {
        commentId: "00000000-0000-0000-0000-000000000003",
        target: { type: "task", id: taskId },
        internal: false,
        authorKind: "internal",
        excerpt: "ok",
      },
      ctx.owner.id,
      "task",
      taskId,
    );
    await dispatchPendingEvents();
    const clientTask = (await notificationsFor(ctx.org.id, clientUser.userId)).filter((n) => n.entityType === "task");
    expect(clientTask).toHaveLength(0);
    const designerTask = (await notificationsFor(ctx.org.id, designer.userId)).filter(
      (n) => n.type === "comment.created" && n.entityType === "task",
    );
    expect(designerTask).toHaveLength(1);
  });

  it("o despachante marca o evento como processado e é idempotente", async () => {
    const id = await emit(
      ctx.org.id,
      "task.assigned",
      { taskId, projectId, title: "Criar post", assigneeMembershipId: designer.membershipId },
      ctx.owner.id,
      "task",
      taskId,
    );
    expect(await processEvent(id)).toBe("processed");
    expect(await processEvent(id)).toBe("skipped");
    await dispatchPendingEvents();
    const [ev] = await withOrg(ctx.org.id, (tx) => tx.select().from(domainEvents).where(eq(domainEvents.id, id)));
    expect(ev!.processedAt).not.toBeNull();
    expect(ev!.attempts).toBe(1);
    const count = (await notificationsFor(ctx.org.id, designer.userId)).filter(
      (n) => n.type === "task.assigned",
    ).length;
    expect(count).toBe(2); // um do teste anterior + um deste evento (sem duplicar)
  });

  it("falha no processamento desfaz tudo e conta a tentativa", async () => {
    const id = await emit(
      ctx.org.id,
      "task.assigned",
      { taskId, assigneeMembershipId: "isso-nao-e-uuid" },
      ctx.owner.id,
      "task",
      taskId,
    );
    expect(await processEvent(id)).toBe("failed");
    const [ev] = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.id, id))),
    );
    expect(ev!.processedAt).toBeNull();
    expect(ev!.attempts).toBe(1);
    expect(ev!.lastError).toBeTruthy();
    // não volta imediatamente (espera com intervalo crescente)
    const r = await dispatchPendingEvents();
    expect(r.failed).toBe(0);
  });
});
