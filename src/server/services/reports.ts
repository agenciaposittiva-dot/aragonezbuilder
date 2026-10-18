import { and, eq, gte, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { BRIEFING_CATEGORY_LABEL } from "@/lib/validators/briefings";
import { REQUEST_STATUS_LABEL } from "@/lib/validators/requests";
import { inSequence } from "@/server/db/sequence";
import {
  aiUsage,
  approvals,
  clients,
  files,
  invoices,
  memberships,
  projects,
  requests,
  roles,
  tasks,
  user,
  workflowStatuses,
} from "@/server/db/schema";
import { assertCan, assertInternal, can, clientScope, projectScope, type Scope } from "@/server/authz";

const TZ = "America/Sao_Paulo";

export const reportParams = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  clientId: z.uuid().optional(),
});
export type ReportParams = z.infer<typeof reportParams>;

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Período padrão: últimos 90 dias. */
export function resolvePeriod(raw: z.input<typeof reportParams>) {
  const p = reportParams.parse(raw);
  const to = p.to ?? todayISO();
  const from = p.from ?? addDays(to, -89);
  return { from: from <= to ? from : to, to, clientId: p.clientId };
}

type Period = ReturnType<typeof resolvePeriod>;

function readAccess(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "reports.read");
}

/** Filtro de escopo + cliente sobre `projects`. */
function projectFilter(s: Scope, p: Period): SQL | undefined {
  return and(projectScope(s.actor), p.clientId ? eq(projects.clientId, p.clientId) : undefined);
}

const localDate = (col: SQL | unknown) => sql`(${col} at time zone ${TZ})::date`;

/* ------------------------------------------------------------------ */
/* Tarefas                                                             */
/* ------------------------------------------------------------------ */

/** Tarefas concluídas por semana (as 8 semanas que terminam na data final do período). */
export async function throughput(s: Scope, p: Period) {
  const weekStart = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  };
  const last = weekStart(p.to);
  const first = addDays(last, -7 * 7);
  const rows = await s.db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${tasks.completedAt} at time zone ${TZ}), 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        isNotNull(tasks.completedAt),
        isNull(tasks.parentTaskId),
        sql`${localDate(tasks.completedAt)} >= ${first}::date`,
        sql`${localDate(tasks.completedAt)} < ${addDays(last, 7)}::date`,
        projectFilter(s, p),
      ),
    )
    .groupBy(sql`1`);
  const map = new Map(rows.map((r) => [r.week, r.n]));
  return Array.from({ length: 8 }, (_, i) => {
    const week = addDays(first, i * 7);
    return { week, completed: map.get(week) ?? 0 };
  });
}

export async function taskStats(s: Scope, p: Period) {
  const [row] = await s.db
    .select({
      completed: sql<number>`count(*) filter (where ${tasks.completedAt} is not null and ${localDate(tasks.completedAt)} between ${p.from}::date and ${p.to}::date)::int`,
      completedWithDue: sql<number>`count(*) filter (where ${tasks.completedAt} is not null and ${tasks.dueDate} is not null and ${localDate(tasks.completedAt)} between ${p.from}::date and ${p.to}::date)::int`,
      onTime: sql<number>`count(*) filter (where ${tasks.completedAt} is not null and ${tasks.dueDate} is not null and ${localDate(tasks.completedAt)} between ${p.from}::date and ${p.to}::date and ${localDate(tasks.completedAt)} <= ${tasks.dueDate})::int`,
      overdueOpen: sql<number>`count(*) filter (where ${tasks.completedAt} is null and ${tasks.dueDate} < ${todayISO()}::date and ${workflowStatuses.category} not in ('done','cancelled'))::int`,
      open: sql<number>`count(*) filter (where ${tasks.completedAt} is null and ${workflowStatuses.category} not in ('done','cancelled'))::int`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(and(isNull(tasks.archivedAt), isNull(tasks.parentTaskId), projectFilter(s, p)));
  return {
    completed: row?.completed ?? 0,
    completedWithDue: row?.completedWithDue ?? 0,
    onTime: row?.onTime ?? 0,
    onTimeRate: row && row.completedWithDue > 0 ? row.onTime / row.completedWithDue : null,
    overdueOpen: row?.overdueOpen ?? 0,
    open: row?.open ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Aprovações                                                          */
/* ------------------------------------------------------------------ */

export async function approvalStats(s: Scope, p: Period) {
  const scope = and(clientScope(s.actor), p.clientId ? eq(files.clientId, p.clientId) : undefined);
  const decidedInPeriod = sql`${approvals.decidedAt} is not null and ${localDate(approvals.decidedAt)} between ${p.from}::date and ${p.to}::date`;
  const byStage = await s.db
    .select({
      stage: approvals.stage,
      decided: sql<number>`count(*) filter (where ${decidedInPeriod})::int`,
      approved: sql<number>`count(*) filter (where ${decidedInPeriod} and ${approvals.status} = 'approved')::int`,
      avgHours: sql<
        number | null
      >`avg(extract(epoch from (${approvals.decidedAt} - ${approvals.requestedAt})) / 3600) filter (where ${decidedInPeriod})`,
      pending: sql<number>`count(*) filter (where ${approvals.status} = 'pending')::int`,
    })
    .from(approvals)
    .innerJoin(files, eq(files.id, approvals.fileId))
    .innerJoin(clients, eq(clients.id, files.clientId))
    .where(scope)
    .groupBy(approvals.stage);

  // Aprovação de primeira: arquivos cuja PRIMEIRA decisão do cliente foi "aprovado".
  const [first] = await s.db
    .execute<{ total: number; approved: number }>(
      sql`
    with firsts as (
      select distinct on (a.file_id) a.file_id, a.status, a.decided_at
      from ${approvals} a
      join ${files} on ${files.id} = a.file_id
      join ${clients} on ${clients.id} = ${files.clientId}
      where a.stage = 'client' and a.decided_at is not null
        ${scope ? sql`and ${scope}` : sql``}
      order by a.file_id, a.decided_at
    )
    select count(*)::int as total, count(*) filter (where status = 'approved')::int as approved
    from firsts
    where (decided_at at time zone ${TZ})::date between ${p.from}::date and ${p.to}::date
  `,
    )
    .then((r) => r.rows);

  const stage = (k: "internal" | "client") => {
    const r = byStage.find((x) => x.stage === k);
    return {
      decided: r?.decided ?? 0,
      approved: r?.approved ?? 0,
      avgHours: r?.avgHours !== null && r?.avgHours !== undefined ? Number(r.avgHours) : null,
      pending: r?.pending ?? 0,
    };
  };
  return {
    internal: stage("internal"),
    client: stage("client"),
    firstPass: {
      total: first?.total ?? 0,
      approved: first?.approved ?? 0,
      rate: first && first.total > 0 ? first.approved / first.total : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Solicitações                                                        */
/* ------------------------------------------------------------------ */

export async function requestStats(s: Scope, p: Period) {
  const scope = and(clientScope(s.actor), p.clientId ? eq(requests.clientId, p.clientId) : undefined);
  const created = sql`${localDate(requests.createdAt)} between ${p.from}::date and ${p.to}::date`;
  const [byStatus, byCategory, [lead]] = await inSequence(
    () =>
      s.db
        .select({ status: requests.status, n: sql<number>`count(*)::int` })
        .from(requests)
        .innerJoin(clients, eq(clients.id, requests.clientId))
        .where(and(scope, created))
        .groupBy(requests.status),
    () =>
      s.db
        .select({ category: requests.category, n: sql<number>`count(*)::int` })
        .from(requests)
        .innerJoin(clients, eq(clients.id, requests.clientId))
        .where(and(scope, created))
        .groupBy(requests.category),
    () =>
      s.db
        .select({
          n: sql<number>`count(*)::int`,
          avgDays: sql<
            number | null
          >`avg(extract(epoch from (${projects.completedAt} - coalesce(${requests.submittedAt}, ${requests.createdAt}))) / 86400)`,
        })
        .from(requests)
        .innerJoin(clients, eq(clients.id, requests.clientId))
        .innerJoin(projects, eq(projects.id, requests.projectId))
        .where(
          and(
            scope,
            isNotNull(projects.completedAt),
            sql`${localDate(projects.completedAt)} between ${p.from}::date and ${p.to}::date`,
          ),
        ),
  );
  return {
    byStatus: byStatus
      .map((r) => ({ key: r.status, label: REQUEST_STATUS_LABEL[r.status] ?? r.status, value: r.n }))
      .sort((a, b) => b.value - a.value),
    byCategory: byCategory
      .map((r) => ({ key: r.category, label: BRIEFING_CATEGORY_LABEL[r.category] ?? r.category, value: r.n }))
      .sort((a, b) => b.value - a.value),
    total: byStatus.reduce((acc, r) => acc + r.n, 0),
    leadTime: {
      count: lead?.n ?? 0,
      avgDays: lead?.avgDays !== null && lead?.avgDays !== undefined ? Number(lead.avgDays) : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Equipe e projetos                                                   */
/* ------------------------------------------------------------------ */

/**
 * Carga = soma das estimativas das tarefas abertas atribuídas com prazo até
 * 7 dias (inclui atrasadas) ÷ capacidade semanal da pessoa.
 */
export async function workload(s: Scope, p: Pick<Period, "clientId">) {
  const horizon = addDays(todayISO(), 7);
  const openTask = and(
    isNull(tasks.completedAt),
    isNull(tasks.archivedAt),
    sql`${workflowStatuses.category} not in ('done','cancelled')`,
    projectScope(s.actor),
    p.clientId ? eq(projects.clientId, p.clientId) : undefined,
  );
  const stats = s.db
    .select({
      membershipId: tasks.assigneeMembershipId,
      open: sql<number>`count(*)::int`.as("open"),
      overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${todayISO()}::date)::int`.as("overdue"),
      upcomingMinutes:
        sql<number>`coalesce(sum(${tasks.estimateMinutes}) filter (where ${tasks.dueDate} <= ${horizon}::date), 0)::int`.as(
          "upcoming_minutes",
        ),
      unestimated:
        sql<number>`count(*) filter (where ${tasks.dueDate} <= ${horizon}::date and ${tasks.estimateMinutes} is null)::int`.as(
          "unestimated",
        ),
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(and(openTask, isNotNull(tasks.assigneeMembershipId)))
    .groupBy(tasks.assigneeMembershipId)
    .as("stats");

  const rows = await s.db
    .select({
      membershipId: memberships.id,
      name: user.name,
      image: user.image,
      roleName: roles.name,
      capacity: memberships.weeklyCapacityMinutes,
      open: sql<number>`coalesce(${stats.open}, 0)`,
      overdue: sql<number>`coalesce(${stats.overdue}, 0)`,
      upcomingMinutes: sql<number>`coalesce(${stats.upcomingMinutes}, 0)`,
      unestimated: sql<number>`coalesce(${stats.unestimated}, 0)`,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(stats, eq(stats.membershipId, memberships.id))
    .where(and(eq(memberships.status, "active"), eq(roles.kind, "internal")))
    .orderBy(sql`coalesce(${stats.upcomingMinutes}, 0) desc`, user.name);

  return rows.map((r) => ({
    ...r,
    open: Number(r.open),
    overdue: Number(r.overdue),
    upcomingMinutes: Number(r.upcomingMinutes),
    unestimated: Number(r.unestimated),
    load: r.capacity > 0 ? Number(r.upcomingMinutes) / r.capacity : null,
  }));
}

export async function projectsByStatus(s: Scope, p: Pick<Period, "clientId">) {
  return s.db
    .select({
      id: workflowStatuses.id,
      name: workflowStatuses.name,
      color: workflowStatuses.color,
      n: sql<number>`count(${projects.id})::int`,
    })
    .from(workflowStatuses)
    .leftJoin(
      projects,
      and(
        eq(projects.statusId, workflowStatuses.id),
        isNull(projects.archivedAt),
        projectFilter(s, { from: "", to: "", clientId: p.clientId }),
      ),
    )
    .where(eq(workflowStatuses.entity, "project"))
    .groupBy(workflowStatuses.id)
    .orderBy(workflowStatuses.position);
}

/* ------------------------------------------------------------------ */
/* IA                                                                  */
/* ------------------------------------------------------------------ */

export async function aiUsageByMonth(s: Scope) {
  assertCan(s.actor, "ai.settings");
  const rows = await s.db.execute<{
    month: string;
    requests: number;
    input: string;
    output: string;
    cost: string;
    errors: number;
  }>(sql`
    with months as (
      select generate_series(date_trunc('month', now() at time zone ${TZ}) - interval '5 months', date_trunc('month', now() at time zone ${TZ}), interval '1 month')::date as month
    )
    select to_char(m.month, 'YYYY-MM') as month,
      count(u.id)::int as requests,
      coalesce(sum(u.input_tokens), 0) as input,
      coalesce(sum(u.output_tokens), 0) as output,
      coalesce(sum(u.cost_micros), 0) as cost,
      count(u.id) filter (where u.status <> 'success')::int as errors
    from months m
    left join ${aiUsage} u on date_trunc('month', u.created_at at time zone ${TZ})::date = m.month
    group by m.month
    order by m.month
  `);
  return rows.rows.map((r) => ({
    month: r.month,
    requests: r.requests,
    tokens: Number(r.input) + Number(r.output),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
    costUsd: Number(r.cost) / 1_000_000,
    errors: r.errors,
  }));
}

/* ------------------------------------------------------------------ */
/* Página de relatórios                                                */
/* ------------------------------------------------------------------ */

export async function buildReport(s: Scope, raw: z.input<typeof reportParams>) {
  readAccess(s);
  const p = resolvePeriod(raw);
  const [weekly, tasksSummary, approvalsSummary, requestsSummary, team, projectsSummary] = await inSequence(
    () => throughput(s, p),
    () => taskStats(s, p),
    () => approvalStats(s, p),
    () => requestStats(s, p),
    () => workload(s, p),
    () => projectsByStatus(s, p),
  );
  const ai = can(s.actor, "ai.settings") ? await aiUsageByMonth(s) : null;
  return {
    period: p,
    weekly,
    tasks: tasksSummary,
    approvals: approvalsSummary,
    requests: requestsSummary,
    team,
    projects: projectsSummary,
    ai,
  };
}

/* ------------------------------------------------------------------ */
/* Exportação CSV                                                      */
/* ------------------------------------------------------------------ */

export const EXPORT_TYPES = {
  tasks: { label: "Tarefas concluídas no período", permission: null },
  approvals: { label: "Aprovações decididas no período", permission: null },
  requests: { label: "Solicitações criadas no período", permission: null },
  workload: { label: "Carga da equipe (agora)", permission: null },
  invoices: { label: "Faturas emitidas no período", permission: "finance.read" },
  ai: { label: "Uso de IA no período", permission: "ai.settings" },
} as const;
export type ExportType = keyof typeof EXPORT_TYPES;

/** Uma página de linhas (cabeçalho + valores) para a exportação em streaming. */
export async function exportPage(
  s: Scope,
  type: ExportType,
  p: Period,
  offset: number,
  limit: number,
): Promise<{ header: string[]; rows: (string | number | null)[][] }> {
  assertInternal(s.actor);
  assertCan(s.actor, "reports.export");
  const perm = EXPORT_TYPES[type].permission;
  if (perm) assertCan(s.actor, perm);

  switch (type) {
    case "tasks": {
      const rows = await s.db
        .select({
          title: tasks.title,
          project: projects.name,
          client: clients.name,
          assignee: user.name,
          dueDate: tasks.dueDate,
          completedAt: tasks.completedAt,
          estimate: tasks.estimateMinutes,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .leftJoin(memberships, eq(memberships.id, tasks.assigneeMembershipId))
        .leftJoin(user, eq(user.id, memberships.userId))
        .where(
          and(
            isNotNull(tasks.completedAt),
            sql`${localDate(tasks.completedAt)} between ${p.from}::date and ${p.to}::date`,
            projectFilter(s, p),
          ),
        )
        .orderBy(tasks.completedAt, tasks.id)
        .limit(limit)
        .offset(offset);
      return {
        header: [
          "Tarefa",
          "Projeto",
          "Cliente",
          "Responsável",
          "Prazo",
          "Concluída em",
          "No prazo",
          "Estimativa (min)",
        ],
        rows: rows.map((r) => {
          const done = r.completedAt ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(r.completedAt) : null;
          return [
            r.title,
            r.project,
            r.client,
            r.assignee,
            r.dueDate,
            done,
            r.dueDate && done ? (done <= r.dueDate ? "sim" : "não") : null,
            r.estimate,
          ];
        }),
      };
    }
    case "approvals": {
      const rows = await s.db
        .select({
          file: files.name,
          client: clients.name,
          stage: approvals.stage,
          status: approvals.status,
          requestedAt: approvals.requestedAt,
          decidedAt: approvals.decidedAt,
          note: approvals.decisionNote,
        })
        .from(approvals)
        .innerJoin(files, eq(files.id, approvals.fileId))
        .innerJoin(clients, eq(clients.id, files.clientId))
        .where(
          and(
            clientScope(s.actor),
            p.clientId ? eq(files.clientId, p.clientId) : undefined,
            isNotNull(approvals.decidedAt),
            sql`${localDate(approvals.decidedAt)} between ${p.from}::date and ${p.to}::date`,
          ),
        )
        .orderBy(approvals.decidedAt, approvals.id)
        .limit(limit)
        .offset(offset);
      return {
        header: [
          "Arquivo",
          "Cliente",
          "Etapa",
          "Decisão",
          "Solicitada em",
          "Decidida em",
          "Horas até decisão",
          "Observação",
        ],
        rows: rows.map((r) => [
          r.file,
          r.client,
          r.stage === "client" ? "Cliente" : "Interna",
          r.status === "approved" ? "Aprovado" : r.status === "changes_requested" ? "Ajustes" : r.status,
          r.requestedAt.toISOString(),
          r.decidedAt?.toISOString() ?? null,
          r.decidedAt ? Math.round(((r.decidedAt.getTime() - r.requestedAt.getTime()) / 3_600_000) * 10) / 10 : null,
          r.note,
        ]),
      };
    }
    case "requests": {
      const rows = await s.db
        .select({
          number: requests.number,
          title: requests.title,
          client: clients.name,
          category: requests.category,
          priority: requests.priority,
          status: requests.status,
          createdAt: requests.createdAt,
          desired: requests.desiredDueDate,
        })
        .from(requests)
        .innerJoin(clients, eq(clients.id, requests.clientId))
        .where(
          and(
            clientScope(s.actor),
            p.clientId ? eq(requests.clientId, p.clientId) : undefined,
            sql`${localDate(requests.createdAt)} between ${p.from}::date and ${p.to}::date`,
          ),
        )
        .orderBy(requests.number)
        .limit(limit)
        .offset(offset);
      return {
        header: ["Nº", "Título", "Cliente", "Categoria", "Prioridade", "Status", "Criada em", "Prazo desejado"],
        rows: rows.map((r) => [
          r.number,
          r.title,
          r.client,
          BRIEFING_CATEGORY_LABEL[r.category] ?? r.category,
          r.priority,
          REQUEST_STATUS_LABEL[r.status] ?? r.status,
          r.createdAt.toISOString(),
          r.desired,
        ]),
      };
    }
    case "workload": {
      if (offset > 0) return { header: [], rows: [] };
      const rows = await workload(s, p);
      return {
        header: [
          "Pessoa",
          "Papel",
          "Tarefas abertas",
          "Atrasadas",
          "Estimativa 7 dias (min)",
          "Sem estimativa",
          "Capacidade semanal (min)",
          "Carga",
        ],
        rows: rows.map((r) => [
          r.name,
          r.roleName,
          r.open,
          r.overdue,
          r.upcomingMinutes,
          r.unestimated,
          r.capacity,
          r.load === null ? null : Math.round(r.load * 100) / 100,
        ]),
      };
    }
    case "invoices": {
      const rows = await s.db
        .select({
          number: invoices.number,
          client: clients.name,
          description: invoices.description,
          amount: invoices.amountCents,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          status: invoices.status,
          paidAt: invoices.paidAt,
        })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(
          and(
            p.clientId ? eq(invoices.clientId, p.clientId) : undefined,
            gte(invoices.issueDate, p.from),
            lte(invoices.issueDate, p.to),
          ),
        )
        .orderBy(invoices.number)
        .limit(limit)
        .offset(offset);
      return {
        header: ["Nº", "Cliente", "Descrição", "Valor (R$)", "Emissão", "Vencimento", "Status", "Pago em"],
        rows: rows.map((r) => [
          r.number,
          r.client,
          r.description,
          (r.amount / 100).toFixed(2).replace(".", ","),
          r.issueDate,
          r.dueDate,
          r.status,
          r.paidAt?.toISOString() ?? null,
        ]),
      };
    }
    case "ai": {
      const rows = await s.db
        .select({
          createdAt: aiUsage.createdAt,
          user: user.name,
          provider: aiUsage.provider,
          model: aiUsage.model,
          operation: aiUsage.operation,
          input: aiUsage.inputTokens,
          output: aiUsage.outputTokens,
          cost: aiUsage.costMicros,
          status: aiUsage.status,
        })
        .from(aiUsage)
        .leftJoin(user, eq(user.id, aiUsage.userId))
        .where(
          and(
            p.clientId ? eq(aiUsage.clientId, p.clientId) : undefined,
            sql`${localDate(aiUsage.createdAt)} between ${p.from}::date and ${p.to}::date`,
          ),
        )
        .orderBy(aiUsage.createdAt, aiUsage.id)
        .limit(limit)
        .offset(offset);
      return {
        header: [
          "Data",
          "Usuário",
          "Provedor",
          "Modelo",
          "Operação",
          "Tokens de entrada",
          "Tokens de saída",
          "Custo (US$)",
          "Status",
        ],
        rows: rows.map((r) => [
          r.createdAt.toISOString(),
          r.user,
          r.provider,
          r.model,
          r.operation,
          r.input,
          r.output,
          r.cost === null ? "não informado" : (r.cost / 1_000_000).toFixed(6).replace(".", ","),
          r.status,
        ]),
      };
    }
  }
}
