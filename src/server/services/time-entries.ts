import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { timeEntryInput } from "@/lib/validators/tasks";
import { memberships, projects, tasks, timeEntries, user } from "@/server/db/schema";
import { assertCan, assertInternal, assertTaskAccess, can, type Scope } from "@/server/authz";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

function assertTrackingEnabled(s: Scope) {
  if (!s.actor.settings.time.trackingEnabled) {
    throw new ValidationError("O registro de tempo está desativado nas configurações da organização.");
  }
}

/** Custo do registro = minutos × custo/hora do membro (centavos), congelado no momento do lançamento. */
async function costFor(s: Scope, membershipId: string, minutes: number) {
  const [m] = await s.db
    .select({ hourly: memberships.hourlyCostCents })
    .from(memberships)
    .where(eq(memberships.id, membershipId));
  return Math.round((minutes * (m?.hourly ?? 0)) / 60);
}

export async function listTimeEntries(s: Scope, taskId: string) {
  assertCan(s.actor, "tasks.read");
  await assertTaskAccess(s, taskId);
  // Na tarefa, a equipe vê todos os registros (transparência); o custo só com `costs.read`.
  const showCost = can(s.actor, "costs.read");
  const rows = await s.db
    .select({
      id: timeEntries.id,
      membershipId: timeEntries.membershipId,
      startedAt: timeEntries.startedAt,
      endedAt: timeEntries.endedAt,
      minutes: timeEntries.minutes,
      note: timeEntries.note,
      billable: timeEntries.billable,
      costCents: timeEntries.costCents,
      name: user.name,
      image: user.image,
    })
    .from(timeEntries)
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(timeEntries.taskId, taskId))
    .orderBy(desc(timeEntries.startedAt));
  return rows.map((r) => ({ ...r, costCents: showCost ? r.costCents : null }));
}

export type TimeEntryRow = Awaited<ReturnType<typeof listTimeEntries>>[number];

/** Cronômetro em andamento do ator (no máximo um por pessoa). */
export async function getRunningTimer(s: Scope) {
  if (s.actor.kind !== "internal") return null;
  const [row] = await s.db
    .select({
      id: timeEntries.id,
      taskId: timeEntries.taskId,
      startedAt: timeEntries.startedAt,
      taskTitle: tasks.title,
      projectName: projects.name,
    })
    .from(timeEntries)
    .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(timeEntries.membershipId, s.actor.membershipId), isNull(timeEntries.endedAt)))
    .limit(1);
  return row ?? null;
}

async function closeEntry(
  s: Scope,
  entry: { id: string; startedAt: Date; membershipId: string },
  endedAt = new Date(),
) {
  const minutes = Math.max(1, Math.round((endedAt.getTime() - entry.startedAt.getTime()) / 60_000));
  await s.db
    .update(timeEntries)
    .set({ endedAt, minutes, costCents: await costFor(s, entry.membershipId, minutes) })
    .where(eq(timeEntries.id, entry.id));
  return minutes;
}

/** Inicia o cronômetro. Um cronômetro já em andamento (em outra tarefa) é encerrado antes. */
export async function startTimer(s: Scope, taskId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "time.track");
  assertTrackingEnabled(s);
  await assertTaskAccess(s, taskId);
  const running = await s.db
    .select({
      id: timeEntries.id,
      startedAt: timeEntries.startedAt,
      membershipId: timeEntries.membershipId,
      taskId: timeEntries.taskId,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.membershipId, s.actor.membershipId), isNull(timeEntries.endedAt)));
  for (const r of running) {
    if (r.taskId === taskId) return { id: r.id };
    await closeEntry(s, r);
  }
  const [row] = await s.db
    .insert(timeEntries)
    .values({
      organizationId: s.actor.orgId,
      taskId,
      membershipId: s.actor.membershipId,
      startedAt: new Date(),
      minutes: 0,
    })
    .returning({ id: timeEntries.id });
  return { id: row!.id };
}

export async function stopTimer(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "time.track");
  const running = await s.db
    .select({
      id: timeEntries.id,
      startedAt: timeEntries.startedAt,
      membershipId: timeEntries.membershipId,
      taskId: timeEntries.taskId,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.membershipId, s.actor.membershipId), isNull(timeEntries.endedAt)));
  if (!running.length) return { minutes: 0 };
  let total = 0;
  for (const r of running) {
    const minutes = await closeEntry(s, r);
    total += minutes;
    await recordActivity(s, {
      action: "time_logged",
      entityType: "task",
      entityId: r.taskId,
      summary: `Tempo registrado: ${minutes} min`,
      event: false,
    });
  }
  return { minutes: total };
}

/** Lançamento manual (sem cronômetro). */
export async function addTimeEntry(s: Scope, raw: z.input<typeof timeEntryInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "time.track");
  assertTrackingEnabled(s);
  const data = timeEntryInput.parse(raw);
  await assertTaskAccess(s, data.taskId);
  const startedAt = new Date(`${data.date}T12:00:00-03:00`);
  const endedAt = new Date(startedAt.getTime() + data.minutes * 60_000);
  const [row] = await s.db
    .insert(timeEntries)
    .values({
      organizationId: s.actor.orgId,
      taskId: data.taskId,
      membershipId: s.actor.membershipId,
      startedAt,
      endedAt,
      minutes: data.minutes,
      note: data.note,
      billable: data.billable,
      costCents: await costFor(s, s.actor.membershipId, data.minutes),
    })
    .returning({ id: timeEntries.id });
  await recordActivity(s, {
    action: "time_logged",
    entityType: "task",
    entityId: data.taskId,
    summary: `Tempo registrado: ${data.minutes} min`,
    event: false,
  });
  return { id: row!.id };
}

/** Cada pessoa exclui os próprios registros; administradores podem excluir qualquer um. */
export async function deleteTimeEntry(s: Scope, id: string) {
  assertInternal(s.actor);
  const [row] = await s.db.select().from(timeEntries).where(eq(timeEntries.id, id));
  if (!row) throw new NotFoundError("Registro não encontrado.");
  await assertTaskAccess(s, row.taskId);
  if (row.membershipId !== s.actor.membershipId && !can(s.actor, "org.manage")) {
    throw new ForbiddenError("Você só pode excluir os seus próprios registros de tempo.");
  }
  await s.db.delete(timeEntries).where(eq(timeEntries.id, id));
}

/** Total de minutos por tarefa (para listagens). */
export async function minutesByTask(s: Scope, taskIds: string[]) {
  if (!taskIds.length) return new Map<string, number>();
  const rows = await s.db
    .select({ taskId: timeEntries.taskId, minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
    .from(timeEntries)
    .where(inArray(timeEntries.taskId, taskIds))
    .groupBy(timeEntries.taskId);
  return new Map(rows.map((r) => [r.taskId, r.minutes]));
}
