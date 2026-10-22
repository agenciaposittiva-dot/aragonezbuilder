import { and, eq, isNull, sql } from "drizzle-orm";
import { todayISO } from "@/lib/format";
import { tasks } from "@/server/db/schema";
import { assertCan, assertInternal, can, taskScope, type Scope } from "@/server/authz";
import { ForbiddenError } from "@/server/errors";
import { assertActiveMembers } from "./members";
import { listTasks } from "./tasks";

/*
 * "Minhas demandas": as tarefas abertas de uma pessoa (inclusive subtarefas
 * atribuídas a ela), com indicadores por prazo. É uma visão sobre as mesmas
 * tarefas da central — nada é copiado: mudar status ou prazo aqui muda a tarefa.
 */

export const DEMAND_FILTERS = ["abertas", "atrasadas", "hoje", "semana"] as const;
export type DemandFilter = (typeof DEMAND_FILTERS)[number];

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * De quem são as demandas exibidas. Ver as de outra pessoa ("Ver como") é de
 * quem distribui tarefas; o escopo de dados de quem consulta continua valendo.
 */
export async function resolveDemandOwner(s: Scope, membershipId?: string | null) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  if (!membershipId || membershipId === s.actor.membershipId) return s.actor.membershipId;
  if (!can(s.actor, "tasks.assign")) throw new ForbiddenError("Você só pode ver as suas demandas.");
  await assertActiveMembers(s, [membershipId]);
  return membershipId;
}

/** Indicadores (abertas da pessoa): sem sobreposição entre "para hoje" e "próximos 7 dias". */
export async function demandIndicators(s: Scope, membershipId: string) {
  const today = todayISO();
  const week = plusDays(today, 7);
  const [row] = await s.db
    .select({
      overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today})::int`,
      today: sql<number>`count(*) filter (where ${tasks.dueDate} = ${today})::int`,
      week: sql<number>`count(*) filter (where ${tasks.dueDate} > ${today} and ${tasks.dueDate} <= ${week})::int`,
      open: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        taskScope(s.actor),
        isNull(tasks.archivedAt),
        isNull(tasks.completedAt),
        eq(tasks.assigneeMembershipId, membershipId),
      ),
    );
  return { overdue: row?.overdue ?? 0, today: row?.today ?? 0, week: row?.week ?? 0, open: row?.open ?? 0 };
}

export type DemandIndicators = Awaited<ReturnType<typeof demandIndicators>>;

/** Demandas abertas da pessoa, filtradas pelo indicador escolhido e pela busca. */
export async function listDemands(
  s: Scope,
  { membershipId, filter = "abertas", q }: { membershipId: string; filter?: DemandFilter; q?: string },
) {
  const today = todayISO();
  const range =
    filter === "atrasadas"
      ? { due: "overdue" as const }
      : filter === "hoje"
        ? { due: "today" as const }
        : filter === "semana"
          ? { from: plusDays(today, 1), to: plusDays(today, 7) }
          : {};
  const { rows } = await listTasks(s, {
    assignee: membershipId,
    open: true,
    subtasks: true,
    sort: "due",
    q: q?.trim() || undefined,
    pageSize: 200,
    ...range,
  });
  return rows;
}
