import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { commentInput, commentTarget, type CommentTarget } from "@/lib/validators/comments";
import { comments, user } from "@/server/db/schema";
import {
  assertFileAccess,
  assertProjectAccess,
  assertRequestAccess,
  assertTaskAccess,
  can,
  type Scope,
} from "@/server/authz";
import { ForbiddenError, NotFoundError } from "@/server/errors";
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

export async function addComment(s: Scope, raw: z.input<typeof commentInput>) {
  const data = commentInput.parse(raw);
  const { values, entity } = await targetCondition(s, data.target);
  const internal = canSeeInternal(s) ? data.internal : false;
  const [row] = await s.db
    .insert(comments)
    .values({ organizationId: s.actor.orgId, authorUserId: s.actor.userId, body: data.body, internal, ...values })
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
        excerpt: data.body.slice(0, 200),
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
