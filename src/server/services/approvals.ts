import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { approvalListParams, decideApprovalInput, requestApprovalInput } from "@/lib/validators/approvals";
import { approvals, clients, files, fileVersions, projects, tasks, user, workflowStatuses } from "@/server/db/schema";
import { assertCan, assertFileAccess, assertTaskAccess, can, fileScope, type Scope } from "@/server/authz";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

const requester = alias(user, "requester");
const decider = alias(user, "decider");

async function loadFile(s: Scope, fileId: string) {
  await assertFileAccess(s, fileId);
  const [file] = await s.db.select().from(files).where(eq(files.id, fileId));
  if (!file || file.deletedAt) throw new NotFoundError("Arquivo não encontrado.");
  return file;
}

/**
 * Envia a versão ATUAL de um arquivo para revisão interna ou aprovação do cliente.
 * A etapa do cliente exige aprovação interna da mesma versão (exceto para quem
 * pode decidir internamente) e compartilha o arquivo com o cliente.
 */
export async function requestApproval(s: Scope, raw: z.input<typeof requestApprovalInput>) {
  if (s.actor.kind !== "internal") throw new ForbiddenError();
  assertCan(s.actor, "approvals.request");
  const data = requestApprovalInput.parse(raw);
  const file = await loadFile(s, data.fileId);
  const versionId = data.versionId ?? file.currentVersionId;
  if (!versionId) throw new ValidationError("O arquivo ainda não tem versão enviada.");
  if (versionId !== file.currentVersionId) {
    throw new ValidationError("Só a versão mais recente do arquivo pode ser enviada para aprovação.");
  }
  const [version] = await s.db
    .select({ versionNumber: fileVersions.versionNumber })
    .from(fileVersions)
    .where(and(eq(fileVersions.id, versionId), eq(fileVersions.fileId, file.id)));
  if (!version) throw new NotFoundError("Versão não encontrada.");

  const taskId = data.taskId ?? file.taskId;
  if (taskId) {
    const task = await assertTaskAccess(s, taskId);
    if (file.projectId && task.projectId !== file.projectId)
      throw new ValidationError("A tarefa escolhida é de outro projeto.");
  }

  if (data.stage === "client") {
    if (!file.clientId) throw new ValidationError("Associe o arquivo a um cliente antes de enviar para aprovação.");
    if (!can(s.actor, "approvals.decide_internal")) {
      const [internalOk] = await s.db
        .select({ id: approvals.id })
        .from(approvals)
        .where(
          and(
            eq(approvals.fileVersionId, versionId),
            eq(approvals.stage, "internal"),
            eq(approvals.status, "approved"),
          ),
        )
        .limit(1);
      if (!internalOk)
        throw new ValidationError("Esta versão precisa ser aprovada na revisão interna antes de ir ao cliente.");
    }
  }

  const [pending] = await s.db
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(eq(approvals.fileVersionId, versionId), eq(approvals.stage, data.stage), eq(approvals.status, "pending")),
    )
    .limit(1);
  if (pending) throw new ConflictError("Já existe uma aprovação pendente desta etapa para esta versão.");

  const [row] = await s.db
    .insert(approvals)
    .values({
      organizationId: s.actor.orgId,
      fileId: file.id,
      fileVersionId: versionId,
      taskId,
      stage: data.stage,
      message: data.message,
      dueDate: data.dueDate,
      requestedByUserId: s.actor.userId,
    })
    .returning({ id: approvals.id });

  await s.db
    .update(files)
    .set({ status: "in_review", ...(data.stage === "client" ? { sharedWithClient: true } : {}) })
    .where(eq(files.id, file.id));

  await recordActivity(s, {
    action: "approval_requested",
    entityType: "file",
    entityId: file.id,
    summary: `${data.stage === "client" ? "Enviado para aprovação do cliente" : "Enviado para revisão interna"} (v${version.versionNumber})`,
    clientVisible: data.stage === "client",
    event: {
      type: "approval.requested",
      payload: {
        approvalId: row!.id,
        fileId: file.id,
        versionId,
        stage: data.stage,
        clientId: file.clientId,
        projectId: file.projectId,
        taskId,
        fileName: file.name,
        dueDate: data.dueDate,
      },
    },
  });
  if (taskId && data.moveTaskToReview) {
    await moveTaskToStatus(s, taskId, data.stage === "client" ? "client_review" : "internal_review", "review", {
      reason: data.stage === "client" ? "enviada para aprovação do cliente" : "enviada para revisão interna",
      skipCategories: ["done", "cancelled"],
    });
  }
  return { id: row!.id };
}

/** Tarefas abertas do projeto do arquivo, para vincular ao pedido de aprovação. */
export async function approvalTaskOptions(s: Scope, fileId: string) {
  if (s.actor.kind !== "internal") throw new ForbiddenError();
  const file = await loadFile(s, fileId);
  if (!file.projectId) return { tasks: [], defaultTaskId: file.taskId };
  const rows = await s.db
    .select({ id: tasks.id, title: tasks.title, statusName: workflowStatuses.name })
    .from(tasks)
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(
      and(
        eq(tasks.projectId, file.projectId),
        isNull(tasks.completedAt),
        isNull(tasks.archivedAt),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(asc(tasks.title))
    .limit(200);
  return { tasks: rows, defaultTaskId: file.taskId };
}

/** Registra a decisão. Só a versão atual pode ser decidida; cada etapa tem seu decisor. */
export async function decideApproval(s: Scope, raw: z.input<typeof decideApprovalInput>) {
  const data = decideApprovalInput.parse(raw);
  if (data.decision === "changes_requested" && !data.note) {
    throw new ValidationError("Descreva os ajustes necessários.", { note: ["Informe o que precisa mudar"] });
  }
  const [approval] = await s.db.select().from(approvals).where(eq(approvals.id, data.approvalId));
  if (!approval) throw new NotFoundError("Aprovação não encontrada.");
  const file = await loadFile(s, approval.fileId);

  if (approval.stage === "internal") {
    if (s.actor.kind !== "internal" || !can(s.actor, "approvals.decide_internal")) {
      throw new ForbiddenError("Apenas a equipe com permissão de revisão interna pode decidir esta etapa.");
    }
  } else {
    if (s.actor.kind !== "client" || !can(s.actor, "approvals.decide_client")) {
      throw new ForbiddenError("A aprovação do cliente só pode ser registrada pelo próprio cliente.");
    }
    if (!file.clientId || !s.actor.clientIds.includes(file.clientId))
      throw new NotFoundError("Aprovação não encontrada.");
  }

  if (approval.status === "superseded")
    throw new ValidationError("Uma nova versão foi enviada: esta aprovação não vale mais.");
  if (approval.status !== "pending") throw new ValidationError("Esta aprovação já foi decidida ou cancelada.");
  if (approval.fileVersionId !== file.currentVersionId) {
    await s.db.update(approvals).set({ status: "superseded" }).where(eq(approvals.id, approval.id));
    throw new ValidationError("Uma nova versão foi enviada: esta aprovação não vale mais.");
  }

  await s.db
    .update(approvals)
    .set({ status: data.decision, decidedByUserId: s.actor.userId, decidedAt: new Date(), decisionNote: data.note })
    .where(eq(approvals.id, approval.id));

  const nextFileStatus =
    data.decision === "changes_requested"
      ? ("changes_requested" as const)
      : approval.stage === "client" || !file.clientId
        ? ("approved" as const)
        : ("in_review" as const);
  await s.db.update(files).set({ status: nextFileStatus }).where(eq(files.id, file.id));

  const [version] = await s.db
    .select({ versionNumber: fileVersions.versionNumber })
    .from(fileVersions)
    .where(eq(fileVersions.id, approval.fileVersionId));

  await recordActivity(s, {
    action: data.decision === "approved" ? "approved" : "changes_requested",
    entityType: "file",
    entityId: file.id,
    summary: `${approval.stage === "client" ? "Cliente" : "Revisão interna"}: ${data.decision === "approved" ? "aprovado" : "ajustes solicitados"} (v${version?.versionNumber ?? "?"})`,
    metadata: data.note ? { note: data.note } : undefined,
    clientVisible: approval.stage === "client",
    event: {
      type: "approval.decided",
      payload: {
        approvalId: approval.id,
        fileId: file.id,
        versionId: approval.fileVersionId,
        stage: approval.stage,
        decision: data.decision,
        clientId: file.clientId,
        projectId: file.projectId,
        taskId: approval.taskId,
        fileName: file.name,
        versionNumber: version?.versionNumber ?? null,
        requestedByUserId: approval.requestedByUserId,
        note: data.note ? data.note.slice(0, 500) : null,
      },
    },
  });

  if (data.decision === "changes_requested" && approval.taskId) {
    await moveTaskToStatus(s, approval.taskId, "adjustments", "in_progress", {
      reason: "ajustes solicitados na aprovação",
    });
  }
}

/**
 * Leva a tarefa vinculada ao status de chave `key` (ou o primeiro da categoria
 * `fallback`): ajustes solicitados → "Ajustes"; envio para revisão (quando a
 * pessoa marca a opção) → status de revisão da etapa. A regra de negócio
 * prevalece sobre o fluxo configurado.
 */
async function moveTaskToStatus(
  s: Scope,
  taskId: string,
  key: string,
  fallback: "in_progress" | "review",
  opts: { reason: string; skipCategories?: string[] },
) {
  const statuses = await s.db
    .select()
    .from(workflowStatuses)
    .where(eq(workflowStatuses.entity, "task"))
    .orderBy(workflowStatuses.position);
  const target = statuses.find((st) => st.key === key) ?? statuses.find((st) => st.category === fallback);
  if (!target) return;
  const [task] = await s.db
    .select({ statusId: tasks.statusId, title: tasks.title })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task || task.statusId === target.id) return;
  const from = statuses.find((st) => st.id === task.statusId);
  if (from && opts.skipCategories?.includes(from.category)) return;
  await s.db.update(tasks).set({ statusId: target.id, completedAt: null }).where(eq(tasks.id, taskId));
  await recordActivity(s, {
    action: "status_changed",
    entityType: "task",
    entityId: taskId,
    summary: `Status: ${from?.name ?? "?"} → ${target.name} (${opts.reason})`,
    changes: { status: { from: from?.name ?? null, to: target.name } },
    event: {
      type: "task.status_changed",
      payload: {
        taskId,
        title: task.title,
        fromStatus: from?.key ?? null,
        toStatus: target.key,
        toCategory: target.category,
      },
    },
  });
}

export async function cancelApproval(s: Scope, approvalId: string) {
  if (s.actor.kind !== "internal") throw new ForbiddenError();
  const [approval] = await s.db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!approval) throw new NotFoundError("Aprovação não encontrada.");
  await assertFileAccess(s, approval.fileId);
  if (approval.requestedByUserId !== s.actor.userId && !can(s.actor, "approvals.decide_internal")) {
    throw new ForbiddenError("Só quem solicitou pode cancelar esta aprovação.");
  }
  if (approval.status !== "pending") throw new ValidationError("Só aprovações pendentes podem ser canceladas.");
  await s.db.update(approvals).set({ status: "cancelled" }).where(eq(approvals.id, approvalId));
  const [stillPending] = await s.db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.fileId, approval.fileId), eq(approvals.status, "pending")))
    .limit(1);
  if (!stillPending) await s.db.update(files).set({ status: "draft" }).where(eq(files.id, approval.fileId));
  await recordActivity(s, {
    action: "approval_cancelled",
    entityType: "file",
    entityId: approval.fileId,
    summary: "Pedido de aprovação cancelado",
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Consulta                                                            */
/* ------------------------------------------------------------------ */

function baseSelect(s: Scope) {
  // Convidados não recebem dados da produção interna (tarefa e quem pediu).
  const isClient = s.actor.kind === "client";
  return s.db
    .select({
      id: approvals.id,
      stage: approvals.stage,
      status: approvals.status,
      message: approvals.message,
      dueDate: approvals.dueDate,
      requestedAt: approvals.requestedAt,
      decidedAt: approvals.decidedAt,
      decisionNote: approvals.decisionNote,
      fileId: files.id,
      fileName: files.name,
      versionId: fileVersions.id,
      versionNumber: fileVersions.versionNumber,
      mimeType: fileVersions.mimeType,
      hasThumbnail: sql<boolean>`${fileVersions.thumbnailKey} is not null`,
      isCurrent: sql<boolean>`${files.currentVersionId} = ${approvals.fileVersionId}`,
      clientId: files.clientId,
      clientName: clients.name,
      projectId: files.projectId,
      projectName: projects.name,
      taskId: isClient ? sql<string | null>`null` : approvals.taskId,
      taskTitle: isClient ? sql<string | null>`null` : tasks.title,
      requestedByName: requester.name,
      requestedByUserId: isClient ? sql<string | null>`null` : approvals.requestedByUserId,
      decidedByName: decider.name,
    })
    .from(approvals)
    .innerJoin(files, eq(files.id, approvals.fileId))
    .innerJoin(fileVersions, eq(fileVersions.id, approvals.fileVersionId))
    .leftJoin(clients, eq(clients.id, files.clientId))
    .leftJoin(projects, eq(projects.id, files.projectId))
    .leftJoin(tasks, eq(tasks.id, approvals.taskId))
    .leftJoin(requester, eq(requester.id, approvals.requestedByUserId))
    .leftJoin(decider, eq(decider.id, approvals.decidedByUserId));
}

export async function listApprovals(s: Scope, raw: z.input<typeof approvalListParams>) {
  assertCan(s.actor, "files.read");
  const p = approvalListParams.parse(raw);
  const isClient = s.actor.kind === "client";
  const scope = and(
    fileScope(s.actor),
    isClient ? eq(approvals.stage, "client") : undefined,
    p.projectId ? eq(files.projectId, p.projectId) : undefined,
    p.clientId ? eq(files.clientId, p.clientId) : undefined,
  );
  if (p.tab === "decided") {
    const since = new Date(Date.now() - 60 * 86_400_000);
    return baseSelect(s)
      .where(and(scope, inArray(approvals.status, ["approved", "changes_requested"]), gte(approvals.decidedAt, since)))
      .orderBy(desc(approvals.decidedAt))
      .limit(100);
  }
  return baseSelect(s)
    .where(and(scope, eq(approvals.status, "pending"), eq(approvals.stage, p.tab)))
    .orderBy(sql`${approvals.dueDate} asc nulls last`, desc(approvals.requestedAt))
    .limit(200);
}

export type ApprovalRow = Awaited<ReturnType<typeof listApprovals>>[number];

/** Todas as rodadas de aprovação de um arquivo (agrupáveis por versão). */
export async function fileApprovals(s: Scope, fileId: string) {
  await assertFileAccess(s, fileId);
  return baseSelect(s)
    .where(and(eq(approvals.fileId, fileId), s.actor.kind === "client" ? eq(approvals.stage, "client") : undefined))
    .orderBy(desc(fileVersions.versionNumber), desc(approvals.requestedAt));
}

export async function approvalCounts(s: Scope, projectId?: string) {
  const rows = await s.db
    .select({ stage: approvals.stage, n: sql<number>`count(*)::int` })
    .from(approvals)
    .innerJoin(files, eq(files.id, approvals.fileId))
    .where(
      and(fileScope(s.actor), eq(approvals.status, "pending"), projectId ? eq(files.projectId, projectId) : undefined),
    )
    .groupBy(approvals.stage);
  return {
    internal: rows.find((r) => r.stage === "internal")?.n ?? 0,
    client: rows.find((r) => r.stage === "client")?.n ?? 0,
  };
}
