import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { commentInput, commentTarget, type CommentTarget } from "@/lib/validators/comments";
import {
  comments,
  memberships,
  projectMembers,
  projects,
  roles,
  taskCollaborators,
  tasks,
  user,
} from "@/server/db/schema";
import {
  assertFileAccess,
  assertProjectAccess,
  assertRequestAccess,
  assertTaskAccess,
  can,
  type Scope,
} from "@/server/authz";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

/** Valida o acesso ao alvo e devolve a condição SQL correspondente. */
async function targetCondition(s: Scope, raw: CommentTarget) {
  const t = commentTarget.parse(raw);
  if (t.taskId) {
    await assertTaskAccess(s, t.taskId);
    return {
      where: eq(comments.taskId, t.taskId),
      entity: { type: "task", id: t.taskId },
      values: { taskId: t.taskId },
    };
  }
  if (t.projectId) {
    await assertProjectAccess(s, t.projectId);
    return {
      where: eq(comments.projectId, t.projectId),
      entity: { type: "project", id: t.projectId },
      values: { projectId: t.projectId },
    };
  }
  if (t.requestId) {
    await assertRequestAccess(s, t.requestId);
    return {
      where: eq(comments.requestId, t.requestId),
      entity: { type: "request", id: t.requestId },
      values: { requestId: t.requestId },
    };
  }
  await assertFileAccess(s, t.fileId!);
  return {
    where: eq(comments.fileId, t.fileId!),
    entity: { type: "file", id: t.fileId! },
    values: { fileId: t.fileId!, fileVersionId: t.fileVersionId ?? null },
  };
}

/** Clientes nunca veem comentários internos; internos sem a permissão também não. */
function canSeeInternal(s: Scope) {
  return s.actor.kind === "internal" && can(s.actor, "comments.internal");
}

export async function listComments(s: Scope, target: CommentTarget) {
  const { where } = await targetCondition(s, target);
  return s.db
    .select({
      id: comments.id,
      body: comments.body,
      internal: comments.internal,
      fileVersionId: comments.fileVersionId,
      mentionedMembershipIds: comments.mentionedMembershipIds,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      authorUserId: comments.authorUserId,
      authorName: user.name,
      authorImage: user.image,
    })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorUserId))
    .where(and(where, isNull(comments.deletedAt), canSeeInternal(s) ? undefined : eq(comments.internal, false)))
    .orderBy(asc(comments.createdAt));
}

export type CommentRow = Awaited<ReturnType<typeof listComments>>[number];

/**
 * Pessoas da equipe que podem ser mencionadas numa tarefa: vínculo ativo,
 * papel interno e acesso à tarefa (acesso a todos os dados, dono ou membro do
 * projeto, responsável ou colaborador). Assim ninguém recebe aviso de algo que
 * não consegue abrir.
 */
export async function taskMentionables(s: Scope, taskId: string) {
  await assertTaskAccess(s, taskId);
  return s.db
    .select({ membershipId: memberships.id, name: user.name, image: user.image })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(tasks, eq(tasks.id, taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(memberships.status, "active"),
        eq(roles.kind, "internal"),
        sql`(
          'data.all' = any(${roles.permissions})
          or ${projects.ownerMembershipId} = ${memberships.id}
          or ${tasks.assigneeMembershipId} = ${memberships.id}
          or exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.membership_id = ${memberships.id})
          or exists (select 1 from ${taskCollaborators} tc where tc.task_id = ${tasks.id} and tc.membership_id = ${memberships.id})
        )`,
      ),
    )
    .orderBy(asc(user.name));
}

async function validMentions(s: Scope, entity: { type: string; id: string }, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  if (s.actor.kind !== "internal" || entity.type !== "task") {
    throw new ValidationError("Menções estão disponíveis apenas nos comentários das tarefas.");
  }
  const allowed = new Set((await taskMentionables(s, entity.id)).map((m) => m.membershipId));
  const denied = unique.filter((id) => !allowed.has(id));
  if (denied.length) {
    const names = await s.db
      .select({ name: user.name })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(inArray(memberships.id, denied));
    throw new ValidationError(
      names.length
        ? `${names.map((n) => n.name).join(", ")} não tem acesso a esta tarefa e não pode ser mencionado.`
        : "Uma das pessoas mencionadas não faz parte da equipe com acesso a esta tarefa.",
    );
  }
  return unique;
}

export async function addComment(s: Scope, raw: z.input<typeof commentInput>) {
  // Na área do cliente, comentar é uma permissão explícita do papel do convidado.
  if (s.actor.kind === "client" && !can(s.actor, "portal.comment")) throw new ForbiddenError();
  const data = commentInput.parse(raw);
  const { values, entity } = await targetCondition(s, data.target);
  // Tarefas são só da equipe: comentários nelas são sempre internos.
  const internal = entity.type === "task" ? true : canSeeInternal(s) ? data.internal : false;
  const mentions = await validMentions(s, entity, data.mentions);
  const [row] = await s.db
    .insert(comments)
    .values({
      organizationId: s.actor.orgId,
      authorUserId: s.actor.userId,
      body: data.body,
      internal,
      mentionedMembershipIds: mentions,
      ...values,
    })
    .returning({ id: comments.id });
  await recordActivity(s, {
    action: "comment_added",
    entityType: entity.type,
    entityId: entity.id,
    summary: internal ? "Comentário interno" : "Comentário",
    clientVisible: !internal,
    event: {
      type: "comment.created",
      payload: {
        commentId: row!.id,
        target: entity,
        internal,
        authorKind: s.actor.kind,
        authorName: s.actor.name,
        excerpt: data.body.slice(0, 200),
        mentionedMembershipIds: mentions,
      },
    },
  });
  return { id: row!.id };
}

export async function deleteComment(s: Scope, id: string) {
  const [row] = await s.db.select().from(comments).where(eq(comments.id, id));
  if (!row || row.deletedAt) throw new NotFoundError("Comentário não encontrado.");
  const isAuthor = row.authorUserId === s.actor.userId;
  const isAdmin = can(s.actor, "org.manage");
  if (!isAuthor && !isAdmin) throw new ForbiddenError("Só o autor pode excluir este comentário.");
  // Revalida o acesso ao alvo (o RLS já restringe à organização).
  await targetCondition(s, {
    taskId: row.taskId ?? undefined,
    projectId: row.projectId ?? undefined,
    requestId: row.requestId ?? undefined,
    fileId: row.fileId ?? undefined,
  });
  await s.db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, id));
}

export async function editComment(s: Scope, id: string, body: string) {
  const text = body.trim();
  if (!text) throw new NotFoundError("Comentário vazio.");
  const [row] = await s.db.select().from(comments).where(eq(comments.id, id));
  if (!row || row.deletedAt) throw new NotFoundError("Comentário não encontrado.");
  if (row.authorUserId !== s.actor.userId) throw new ForbiddenError("Só o autor pode editar este comentário.");
  await s.db
    .update(comments)
    .set({ body: text.slice(0, 10000), editedAt: new Date() })
    .where(eq(comments.id, id));
}
