import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { workflowStatuses, workflowTransitions } from "@/server/db/schema";
import { assertCan, type Scope } from "@/server/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

export type WorkflowEntity = "project" | "task";

export type StatusRow = typeof workflowStatuses.$inferSelect;

export async function listStatuses(s: Scope, entity: WorkflowEntity): Promise<StatusRow[]> {
  return s.db
    .select()
    .from(workflowStatuses)
    .where(eq(workflowStatuses.entity, entity))
    .orderBy(asc(workflowStatuses.position), asc(workflowStatuses.createdAt));
}

export async function getDefaultStatus(s: Scope, entity: WorkflowEntity): Promise<StatusRow> {
  const statuses = await listStatuses(s, entity);
  const def = statuses.find((st) => st.isDefault) ?? statuses.find((st) => st.category === "todo") ?? statuses[0];
  if (!def) throw new NotFoundError("Nenhum status configurado.");
  return def;
}

export async function getStatus(s: Scope, entity: WorkflowEntity, id: string): Promise<StatusRow> {
  const [row] = await s.db
    .select()
    .from(workflowStatuses)
    .where(and(eq(workflowStatuses.id, id), eq(workflowStatuses.entity, entity)));
  if (!row) throw new NotFoundError("Status não encontrado.");
  return row;
}

export async function findStatusByCategory(s: Scope, entity: WorkflowEntity, category: StatusRow["category"]) {
  const statuses = await listStatuses(s, entity);
  return statuses.find((st) => st.category === category) ?? null;
}

export async function listTransitions(s: Scope) {
  return s.db.select().from(workflowTransitions);
}

/**
 * Valida a transição de status. Se o status de origem não tiver transições
 * cadastradas, qualquer destino é aceito (fluxo livre).
 */
export async function assertTransition(s: Scope, fromId: string, toId: string) {
  if (fromId === toId) return;
  const rows = await s.db
    .select({ toStatusId: workflowTransitions.toStatusId })
    .from(workflowTransitions)
    .where(eq(workflowTransitions.fromStatusId, fromId));
  if (rows.length && !rows.some((r) => r.toStatusId === toId)) {
    const [from, to] = await Promise.all([
      s.db.select({ name: workflowStatuses.name }).from(workflowStatuses).where(eq(workflowStatuses.id, fromId)),
      s.db.select({ name: workflowStatuses.name }).from(workflowStatuses).where(eq(workflowStatuses.id, toId)),
    ]);
    throw new ValidationError(
      `Transição não permitida: "${from[0]?.name ?? "?"}" → "${to[0]?.name ?? "?"}". Ajuste o fluxo em Configurações.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Configuração (Configurações → Fluxos)                               */
/* ------------------------------------------------------------------ */

export const statusInput = z.object({
  id: z.uuid().optional(),
  entity: z.enum(["project", "task"]),
  name: z.string().trim().min(1).max(40),
  category: z.enum(["backlog", "todo", "in_progress", "review", "done", "cancelled"]),
  color: z.string().max(20).default("slate"),
});

export async function saveStatus(s: Scope, input: z.infer<typeof statusInput>) {
  assertCan(s.actor, "org.manage");
  const data = statusInput.parse(input);
  if (data.id) {
    const before = await getStatus(s, data.entity, data.id);
    await s.db
      .update(workflowStatuses)
      .set({ name: data.name, category: data.category, color: data.color })
      .where(eq(workflowStatuses.id, data.id));
    await recordActivity(s, {
      action: "updated",
      entityType: "workflow_status",
      entityId: data.id,
      summary: `Status "${before.name}" atualizado`,
      event: false,
    });
    return data.id;
  }
  const [{ max } = { max: 0 }] = await s.db
    .select({ max: sql<number>`coalesce(max(${workflowStatuses.position}), -1)::int` })
    .from(workflowStatuses)
    .where(eq(workflowStatuses.entity, data.entity));
  const key = `${data.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 30)}_${Date.now().toString(36)}`;
  const [row] = await s.db
    .insert(workflowStatuses)
    .values({
      organizationId: s.actor.orgId,
      entity: data.entity,
      key,
      name: data.name,
      category: data.category,
      color: data.color,
      position: max + 1,
    })
    .returning({ id: workflowStatuses.id });
  await recordActivity(s, {
    action: "created",
    entityType: "workflow_status",
    entityId: row!.id,
    summary: `Status "${data.name}" criado`,
    event: false,
  });
  return row!.id;
}

export async function reorderStatuses(s: Scope, entity: WorkflowEntity, orderedIds: string[]) {
  assertCan(s.actor, "org.manage");
  await Promise.all(
    orderedIds.map((id, i) =>
      s.db
        .update(workflowStatuses)
        .set({ position: i })
        .where(and(eq(workflowStatuses.id, id), eq(workflowStatuses.entity, entity))),
    ),
  );
}

export async function setDefaultStatus(s: Scope, entity: WorkflowEntity, id: string) {
  assertCan(s.actor, "org.manage");
  await getStatus(s, entity, id);
  await s.db.update(workflowStatuses).set({ isDefault: false }).where(eq(workflowStatuses.entity, entity));
  await s.db.update(workflowStatuses).set({ isDefault: true }).where(eq(workflowStatuses.id, id));
}

export async function deleteStatus(s: Scope, entity: WorkflowEntity, id: string) {
  assertCan(s.actor, "org.manage");
  const status = await getStatus(s, entity, id);
  if (status.isDefault) throw new ConflictError("Defina outro status padrão antes de excluir este.");
  try {
    await s.db.delete(workflowStatuses).where(eq(workflowStatuses.id, id));
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      throw new ConflictError("Há registros usando este status. Mova-os para outro status antes de excluir.");
    }
    throw err;
  }
  await recordActivity(s, {
    action: "deleted",
    entityType: "workflow_status",
    entityId: id,
    summary: `Status "${status.name}" excluído`,
    event: false,
  });
}

/** Substitui as transições permitidas a partir de um status. Lista vazia = fluxo livre. */
export async function setTransitions(s: Scope, fromStatusId: string, toStatusIds: string[]) {
  assertCan(s.actor, "org.manage");
  await s.db.delete(workflowTransitions).where(eq(workflowTransitions.fromStatusId, fromStatusId));
  const targets = [...new Set(toStatusIds)].filter((id) => id !== fromStatusId);
  if (targets.length) {
    await s.db.insert(workflowTransitions).values(
      targets.map((toStatusId) => ({ organizationId: s.actor.orgId, fromStatusId, toStatusId })),
    );
  }
}
