import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { todayISO } from "@/lib/format";
import { addDays, describeRule, firstOccurrence, nextAfterToday, type RecurrenceRule } from "@/lib/recurrence";
import { routineInput } from "@/lib/validators/tasks";
import { withSystem } from "@/server/db";
import { clients, memberships, organizations, projects, taskRecurrences, tasks, user } from "@/server/db/schema";
import { assertCan, assertInternal, assertProjectAccess, inOrg, projectScope, type Scope } from "@/server/authz";
import { resolveActor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/errors";
import { recordActivity } from "./activity";
import { assertActiveMembers } from "./members";
import { createTask } from "./tasks";

/*
 * Rotina: tarefas recorrentes de um projeto (limpeza de pastas, relatório
 * mensal, escala de stories…). A regra fica em task_recurrences; o worker/cron
 * cria a tarefa na data e avança para a próxima. Cada ocorrência é
 * "reivindicada" avançando next_run_on com a data esperada (trava otimista) e a
 * tarefa guarda recurrence_id + recurrence_on (índice único): nunca duplica.
 */

const ruleOf = (r: {
  frequency: RecurrenceRule["frequency"];
  interval: number;
  weekday: number | null;
  monthday: number | null;
}) => ({
  frequency: r.frequency,
  interval: r.interval,
  weekday: r.weekday,
  monthday: r.monthday,
});

export async function listRoutines(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  const assignee = user;
  const rows = await s.db
    .select({
      id: taskRecurrences.id,
      title: taskRecurrences.title,
      description: taskRecurrences.description,
      projectId: taskRecurrences.projectId,
      projectName: projects.name,
      clientName: clients.name,
      assigneeMembershipId: taskRecurrences.assigneeMembershipId,
      assigneeName: assignee.name,
      priority: taskRecurrences.priority,
      frequency: taskRecurrences.frequency,
      interval: taskRecurrences.interval,
      weekday: taskRecurrences.weekday,
      monthday: taskRecurrences.monthday,
      dueInDays: taskRecurrences.dueInDays,
      nextRunOn: taskRecurrences.nextRunOn,
      lastRunOn: taskRecurrences.lastRunOn,
      active: taskRecurrences.active,
      generated: sql<number>`(select count(*)::int from ${tasks} t where t.recurrence_id = ${taskRecurrences.id})`,
    })
    .from(taskRecurrences)
    .innerJoin(projects, eq(projects.id, taskRecurrences.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(memberships, eq(memberships.id, taskRecurrences.assigneeMembershipId))
    .leftJoin(assignee, eq(assignee.id, memberships.userId))
    .where(and(projectScope(s.actor), isNull(projects.deletedAt)))
    .orderBy(asc(taskRecurrences.nextRunOn), asc(taskRecurrences.title));
  return rows.map((r) => ({ ...r, ruleText: describeRule(ruleOf(r)) }));
}

export type RoutineRow = Awaited<ReturnType<typeof listRoutines>>[number];

export async function saveRoutine(s: Scope, raw: z.input<typeof routineInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = routineInput.parse(raw);
  await assertProjectAccess(s, data.projectId);
  if (data.assigneeMembershipId && data.assigneeMembershipId !== s.actor.membershipId) {
    assertCan(s.actor, "tasks.assign");
  }
  await assertActiveMembers(s, [data.assigneeMembershipId]);
  const rule = {
    frequency: data.frequency,
    interval: data.interval,
    weekday: data.frequency === "weekly" ? (data.weekday ?? null) : null,
    monthday: data.frequency === "monthly" ? (data.monthday ?? null) : null,
  };
  const today = todayISO();
  const start = data.startOn && data.startOn > today ? data.startOn : today;
  const values = {
    projectId: data.projectId,
    title: data.title,
    description: data.description ?? null,
    assigneeMembershipId: data.assigneeMembershipId,
    priority: data.priority,
    ...rule,
    dueInDays: data.dueInDays,
    // Mudar a regra recalcula a próxima data (a partir de hoje ou do início escolhido).
    nextRunOn: firstOccurrence(rule, start),
  };
  if (data.id) {
    const res = await s.db
      .update(taskRecurrences)
      .set(values)
      .where(eq(taskRecurrences.id, data.id))
      .returning({ id: taskRecurrences.id });
    if (!res.length) throw new NotFoundError("Rotina não encontrada.");
    await recordActivity(s, {
      action: "routine_updated",
      entityType: "project",
      entityId: data.projectId,
      summary: `Rotina atualizada: ${data.title} (${describeRule(rule)})`,
      event: false,
    });
    return { id: data.id, nextRunOn: values.nextRunOn };
  }
  const [row] = await s.db
    .insert(taskRecurrences)
    .values({ organizationId: s.actor.orgId, ...values, createdByUserId: s.actor.userId })
    .returning({ id: taskRecurrences.id });
  await recordActivity(s, {
    action: "routine_created",
    entityType: "project",
    entityId: data.projectId,
    summary: `Rotina criada: ${data.title} (${describeRule(rule)})`,
    event: false,
  });
  return { id: row!.id, nextRunOn: values.nextRunOn };
}

async function loadRoutine(s: Scope, id: string) {
  const [r] = await s.db.select().from(taskRecurrences).where(eq(taskRecurrences.id, id));
  if (!r) throw new NotFoundError("Rotina não encontrada.");
  await assertProjectAccess(s, r.projectId);
  return r;
}

export async function setRoutineActive(s: Scope, id: string, active: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const r = await loadRoutine(s, id);
  // Ao reativar, a próxima data recomeça de hoje (não cria as que passaram durante a pausa).
  const nextRunOn = active ? firstOccurrence(ruleOf(r), todayISO()) : r.nextRunOn;
  await s.db.update(taskRecurrences).set({ active, nextRunOn }).where(eq(taskRecurrences.id, id));
  await recordActivity(s, {
    action: active ? "routine_resumed" : "routine_paused",
    entityType: "project",
    entityId: r.projectId,
    summary: `Rotina ${active ? "retomada" : "pausada"}: ${r.title}`,
    event: false,
  });
}

/** Exclui a regra. As tarefas já criadas continuam (perdem só o vínculo com a rotina). */
export async function deleteRoutine(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const r = await loadRoutine(s, id);
  await s.db.delete(taskRecurrences).where(eq(taskRecurrences.id, id));
  await recordActivity(s, {
    action: "routine_deleted",
    entityType: "project",
    entityId: r.projectId,
    summary: `Rotina excluída: ${r.title} (as tarefas criadas continuam)`,
    event: false,
  });
}

/**
 * Gera as tarefas das rotinas vencidas (worker/cron; idempotente). Cada
 * tarefa é criada em nome de quem criou a rotina, com as mesmas regras de
 * acesso; se essa pessoa não tem mais acesso, a ocorrência é pulada e
 * registrada no histórico do projeto.
 */
export async function generateRoutineTasks(today = todayISO()): Promise<{ created: number; skipped: number }> {
  const due = await withSystem((tx) =>
    tx
      .select({
        id: taskRecurrences.id,
        organizationId: taskRecurrences.organizationId,
        orgSlug: organizations.slug,
        createdByUserId: taskRecurrences.createdByUserId,
      })
      .from(taskRecurrences)
      .innerJoin(organizations, eq(organizations.id, taskRecurrences.organizationId))
      .innerJoin(projects, eq(projects.id, taskRecurrences.projectId))
      .where(
        and(
          eq(taskRecurrences.active, true),
          lte(taskRecurrences.nextRunOn, today),
          isNull(organizations.deletedAt),
          isNull(projects.deletedAt),
          isNull(projects.archivedAt),
        ),
      )
      .limit(500),
  );
  let created = 0;
  let skipped = 0;
  for (const r of due) {
    const actor = r.createdByUserId ? await resolveActor(r.createdByUserId, r.orgSlug) : null;
    if (!actor || actor.kind !== "internal") {
      skipped++;
      continue;
    }
    try {
      const made = await inOrg(actor, async (s) => {
        const [rule] = await s.db.select().from(taskRecurrences).where(eq(taskRecurrences.id, r.id));
        if (!rule || !rule.active || rule.nextRunOn > today) return false;
        const occurrence = rule.nextRunOn;
        // Reivindica a ocorrência: só quem avançar a data a partir do valor esperado cria a tarefa.
        const claimed = await s.db
          .update(taskRecurrences)
          .set({ nextRunOn: nextAfterToday(ruleOf(rule), occurrence, today), lastRunOn: occurrence })
          .where(and(eq(taskRecurrences.id, rule.id), eq(taskRecurrences.nextRunOn, occurrence)))
          .returning({ id: taskRecurrences.id });
        if (!claimed.length) return false;
        const task = await createTask(s, {
          projectId: rule.projectId,
          title: rule.title,
          description: rule.description,
          priority: rule.priority,
          assigneeMembershipId: rule.assigneeMembershipId,
          dueDate: addDays(occurrence, rule.dueInDays),
        });
        await s.db.update(tasks).set({ recurrenceId: rule.id, recurrenceOn: occurrence }).where(eq(tasks.id, task.id));
        return true;
      });
      if (made) created++;
    } catch (err) {
      // Uma rotina com problema (ex.: responsável saiu) não impede as outras.
      console.error("[rotina] falha ao gerar tarefa", r.id, err);
      skipped++;
    }
  }
  return { created, skipped };
}
