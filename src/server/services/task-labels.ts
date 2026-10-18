import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { labelInput, SAVED_VIEW_KEYS, savedViewInput, taskListParams } from "@/lib/validators/tasks";
import { taskLabelLinks, taskLabels, taskSavedViews } from "@/server/db/schema";
import { assertCan, assertInternal, assertTaskAccess, type Scope } from "@/server/authz";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

/*
 * Etiquetas de tarefa (por organização) e filtros salvos da central (por
 * pessoa). Criar e aplicar etiquetas é de quem edita tarefas; renomear,
 * recolorir e excluir mexe em todas as tarefas, então fica com quem gerencia
 * a organização.
 */

export async function listLabels(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  return s.db
    .select({
      id: taskLabels.id,
      name: taskLabels.name,
      color: taskLabels.color,
      uses: sql<number>`(select count(*)::int from ${taskLabelLinks} l where l.label_id = ${taskLabels.id})`,
    })
    .from(taskLabels)
    .orderBy(asc(sql`lower(${taskLabels.name})`));
}

export type LabelRow = Awaited<ReturnType<typeof listLabels>>[number];

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function saveLabel(s: Scope, raw: z.input<typeof labelInput>) {
  assertInternal(s.actor);
  const data = labelInput.parse(raw);
  assertCan(s.actor, data.id ? "org.manage" : "tasks.write");
  try {
    // Savepoint: um nome repetido não pode abortar a transação inteira da ação.
    return await s.db.transaction(async (tx) => {
      if (data.id) {
        const res = await tx
          .update(taskLabels)
          .set({ name: data.name, color: data.color })
          .where(eq(taskLabels.id, data.id))
          .returning({ id: taskLabels.id });
        if (!res.length) throw new NotFoundError("Etiqueta não encontrada.");
        return { id: data.id };
      }
      const [row] = await tx
        .insert(taskLabels)
        .values({ organizationId: s.actor.orgId, name: data.name, color: data.color, createdByUserId: s.actor.userId })
        .returning({ id: taskLabels.id });
      return { id: row!.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("Já existe uma etiqueta com esse nome.", { name: ["Nome em uso"] });
    }
    throw err;
  }
}

export async function deleteLabel(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "org.manage");
  const [row] = await s.db.delete(taskLabels).where(eq(taskLabels.id, id)).returning({ name: taskLabels.name });
  if (!row) throw new NotFoundError("Etiqueta não encontrada.");
  await recordActivity(s, {
    action: "deleted",
    entityType: "task_label",
    entityId: id,
    summary: `Etiqueta excluída: ${row.name}`,
    event: false,
  });
}

/** Substitui as etiquetas de uma tarefa. */
export async function setTaskLabels(s: Scope, taskId: string, labelIds: string[]) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  const ids = [...new Set(labelIds)];
  const found = ids.length
    ? await s.db
        .select({ id: taskLabels.id, name: taskLabels.name })
        .from(taskLabels)
        .where(inArray(taskLabels.id, ids))
    : [];
  if (found.length !== ids.length) throw new ValidationError("Uma das etiquetas não existe mais.");
  await s.db.delete(taskLabelLinks).where(eq(taskLabelLinks.taskId, taskId));
  if (ids.length) {
    await s.db
      .insert(taskLabelLinks)
      .values(ids.map((labelId) => ({ organizationId: s.actor.orgId, taskId, labelId })));
  }
  await recordActivity(s, {
    action: "labels_updated",
    entityType: "task",
    entityId: taskId,
    summary: found.length ? `Etiquetas: ${found.map((f) => f.name).join(", ")}` : "Etiquetas removidas",
    event: false,
  });
}

/** Etiquetas de várias tarefas (para quadro, lista e detalhe). */
export async function labelsOfTasks(s: Scope, taskIds: string[]) {
  const map = new Map<string, { id: string; name: string; color: string }[]>();
  if (!taskIds.length) return map;
  const rows = await s.db
    .select({ taskId: taskLabelLinks.taskId, id: taskLabels.id, name: taskLabels.name, color: taskLabels.color })
    .from(taskLabelLinks)
    .innerJoin(taskLabels, eq(taskLabels.id, taskLabelLinks.labelId))
    .where(inArray(taskLabelLinks.taskId, taskIds))
    .orderBy(asc(sql`lower(${taskLabels.name})`));
  for (const r of rows) map.set(r.taskId, [...(map.get(r.taskId) ?? []), { id: r.id, name: r.name, color: r.color }]);
  return map;
}

/* ------------------------------------------------------------------ */
/* Filtros salvos                                                      */
/* ------------------------------------------------------------------ */

/** Mantém só parâmetros conhecidos e válidos (o filtro salvo nunca vira uma URL arbitrária). */
export function normalizeViewQuery(query: string) {
  const input = new URLSearchParams(query.replace(/^\?/, ""));
  const out = new URLSearchParams();
  for (const key of SAVED_VIEW_KEYS) {
    const v = input.get(key);
    if (v !== null && v !== "" && v.length <= 200) out.set(key, v);
  }
  const check = taskListParams.safeParse(Object.fromEntries(out));
  if (!check.success) throw new ValidationError("Os filtros atuais têm valores inválidos.");
  return out.toString();
}

export async function listSavedViews(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  return s.db
    .select({ id: taskSavedViews.id, name: taskSavedViews.name, query: taskSavedViews.query })
    .from(taskSavedViews)
    .where(eq(taskSavedViews.membershipId, s.actor.membershipId))
    .orderBy(asc(taskSavedViews.name));
}

export async function saveView(s: Scope, raw: z.input<typeof savedViewInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  const data = savedViewInput.parse(raw);
  const query = normalizeViewQuery(data.query);
  if (!query) throw new ValidationError("Aplique algum filtro antes de salvar.");
  const [{ n } = { n: 0 }] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(taskSavedViews)
    .where(eq(taskSavedViews.membershipId, s.actor.membershipId));
  if (n >= 30) throw new ValidationError("Você já tem 30 filtros salvos. Exclua algum para salvar outro.");
  const [row] = await s.db
    .insert(taskSavedViews)
    .values({ organizationId: s.actor.orgId, membershipId: s.actor.membershipId, name: data.name, query })
    .returning({ id: taskSavedViews.id });
  return { id: row!.id, query };
}

export async function deleteSavedView(s: Scope, id: string) {
  assertInternal(s.actor);
  const res = await s.db
    .delete(taskSavedViews)
    .where(and(eq(taskSavedViews.id, id), eq(taskSavedViews.membershipId, s.actor.membershipId)))
    .returning({ id: taskSavedViews.id });
  if (!res.length) throw new NotFoundError("Filtro não encontrado.");
}
