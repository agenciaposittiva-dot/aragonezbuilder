import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { inSequence } from "@/server/db/sequence";
import {
  approvals,
  auditLogs,
  clients,
  files,
  memberships,
  projects,
  requests,
  tasks,
  user,
  workflowStatuses,
} from "@/server/db/schema";
import { assertInternal, can, projectScope, taskScope, type Scope } from "@/server/authz";
import { currentMrr } from "./finance";

const TZ = "America/Sao_Paulo";

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const openTask = and(
  isNull(tasks.completedAt),
  isNull(tasks.archivedAt),
  sql`${workflowStatuses.category} not in ('done','cancelled')`,
);

/** Minhas tarefas abertas com prazo até 7 dias (inclui atrasadas). */
async function myTasks(s: Scope) {
  const today = todayISO();
  const rows = await s.db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      projectId: projects.id,
      projectName: projects.name,
      clientName: clients.name,
      statusName: workflowStatuses.name,
      statusColor: workflowStatuses.color,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(and(openTask, eq(tasks.assigneeMembershipId, s.actor.membershipId), lte(tasks.dueDate, addDays(today, 7))))
    .orderBy(asc(tasks.dueDate), desc(tasks.priority))
    .limit(30);
  const [noDue] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(and(openTask, eq(tasks.assigneeMembershipId, s.actor.membershipId), isNull(tasks.dueDate)));
  return {
    overdue: rows.filter((r) => r.dueDate! < today),
    today: rows.filter((r) => r.dueDate === today),
    upcoming: rows.filter((r) => r.dueDate! > today),
    withoutDue: noDue?.n ?? 0,
  };
}

/** Aprovações internas pendentes que o ator pode decidir (dentro do seu escopo). */
async function approvalsWaiting(s: Scope) {
  if (!can(s.actor, "approvals.decide_internal")) return [];
  return s.db
    .select({
      id: approvals.id,
      fileId: files.id,
      fileName: files.name,
      projectName: projects.name,
      clientName: clients.name,
      requestedAt: approvals.requestedAt,
      requestedBy: user.name,
    })
    .from(approvals)
    .innerJoin(files, eq(files.id, approvals.fileId))
    .leftJoin(projects, eq(projects.id, files.projectId))
    .leftJoin(clients, eq(clients.id, files.clientId))
    .leftJoin(user, eq(user.id, approvals.requestedByUserId))
    .where(
      and(
        eq(approvals.status, "pending"),
        eq(approvals.stage, "internal"),
        or(isNull(files.projectId), projectScope(s.actor) ?? sql`true`),
      ),
    )
    .orderBy(asc(approvals.requestedAt))
    .limit(8);
}

async function requestsToTriage(s: Scope) {
  if (!can(s.actor, "requests.triage")) return [];
  return s.db
    .select({
      id: requests.id,
      number: requests.number,
      title: requests.title,
      priority: requests.priority,
      clientName: clients.name,
      createdAt: requests.createdAt,
      desiredDueDate: requests.desiredDueDate,
    })
    .from(requests)
    .innerJoin(clients, eq(clients.id, requests.clientId))
    .where(inArray(requests.status, ["submitted", "triage"]))
    .orderBy(
      sql`case ${requests.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
      asc(requests.createdAt),
    )
    .limit(8);
}

/** Projetos com tarefas atrasadas ou com prazo em até 7 dias e menos de 50% concluído. */
async function projectsAtRisk(s: Scope) {
  const today = todayISO();
  const rows = await s.db.execute<{
    id: string;
    name: string;
    client_name: string;
    due_date: string | null;
    total: number;
    done: number;
    overdue: number;
  }>(sql`
    select * from (
      select projects.id, projects.name, c.name as client_name, projects.due_date,
        (select count(*)::int from tasks t where t.project_id = projects.id and t.archived_at is null and t.parent_task_id is null) as total,
        (select count(*)::int from tasks t where t.project_id = projects.id and t.archived_at is null and t.parent_task_id is null and t.completed_at is not null) as done,
        (select count(*)::int from tasks t join workflow_statuses tws on tws.id = t.status_id
          where t.project_id = projects.id and t.archived_at is null and t.completed_at is null
            and tws.category not in ('done','cancelled') and t.due_date < ${today}::date) as overdue
      from ${projects}
      join ${clients} c on c.id = projects.client_id
      join ${workflowStatuses} ws on ws.id = projects.status_id
      where projects.archived_at is null and ws.category not in ('done','cancelled')
        ${projectScope(s.actor) ? sql`and ${projectScope(s.actor)}` : sql``}
    ) x
    where overdue > 0
       or (due_date is not null and due_date <= ${addDays(today, 7)}::date and (total = 0 or done::float / total < 0.5))
    order by overdue desc, due_date asc nulls last
    limit 8
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    clientName: r.client_name,
    dueDate: r.due_date,
    progress: r.total ? r.done / r.total : 0,
    total: r.total,
    overdue: r.overdue,
  }));
}

/** Atividade recente dentro do escopo do ator. */
async function recentActivity(s: Scope) {
  const visibleProjects = s.db.select({ id: projects.id }).from(projects).where(projectScope(s.actor));
  const visibleTasks = s.db.select({ id: tasks.id }).from(tasks).where(taskScope(s.actor));
  const scope = s.actor.dataAll
    ? sql`${auditLogs.entityType} in ('client','project','task','request','file','approval','invoice')`
    : or(
        eq(auditLogs.actorUserId, s.actor.userId),
        and(eq(auditLogs.entityType, "project"), inArray(auditLogs.entityId, visibleProjects)),
        and(eq(auditLogs.entityType, "task"), inArray(auditLogs.entityId, visibleTasks)),
      );
  const financeHidden = can(s.actor, "finance.read")
    ? undefined
    : sql`${auditLogs.entityType} not in ('invoice','expense')`;
  return s.db
    .select({
      id: auditLogs.id,
      summary: auditLogs.summary,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
      actorName: user.name,
      actorImage: user.image,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorUserId))
    .where(and(scope, financeHidden))
    .orderBy(desc(auditLogs.createdAt))
    .limit(12);
}

/** Indicadores para gestores (quem tem visão de toda a operação). */
async function managerKpis(s: Scope) {
  if (!(s.actor.dataAll && can(s.actor, "reports.read"))) return null;
  const today = todayISO();
  const [[activeProjects], [overdueTasks], [pendingApprovals]] = await inSequence(
    () =>
      s.db
        .select({ n: sql<number>`count(*)::int` })
        .from(projects)
        .innerJoin(workflowStatuses, eq(workflowStatuses.id, projects.statusId))
        .where(and(isNull(projects.archivedAt), sql`${workflowStatuses.category} not in ('done','cancelled')`)),
    () =>
      s.db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
        .where(and(openTask, sql`${tasks.dueDate} < ${today}::date`)),
    () =>
      s.db
        .select({
          internal: sql<number>`count(*) filter (where ${approvals.stage} = 'internal')::int`,
          client: sql<number>`count(*) filter (where ${approvals.stage} = 'client')::int`,
        })
        .from(approvals)
        .where(eq(approvals.status, "pending")),
  );
  const mrr = can(s.actor, "finance.read") ? await currentMrr(s) : null;
  const [{ n: team } = { n: 0 }] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.status, "active"));
  return {
    activeProjects: activeProjects?.n ?? 0,
    overdueTasks: overdueTasks?.n ?? 0,
    pendingInternal: pendingApprovals?.internal ?? 0,
    pendingClient: pendingApprovals?.client ?? 0,
    mrrCents: mrr,
    members: team,
  };
}

export async function getDashboard(s: Scope) {
  assertInternal(s.actor);
  const [tasksMine, waiting, triage, risk, activity, kpis] = await inSequence(
    () =>
      can(s.actor, "tasks.read")
        ? myTasks(s)
        : Promise.resolve({ overdue: [], today: [], upcoming: [], withoutDue: 0 }),
    () => approvalsWaiting(s),
    () => requestsToTriage(s),
    () => (can(s.actor, "projects.read") ? projectsAtRisk(s) : Promise.resolve([])),
    () => recentActivity(s),
    () => managerKpis(s),
  );
  return { tasks: tasksMine, approvals: waiting, requests: triage, projectsAtRisk: risk, activity, kpis };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
