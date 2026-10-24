import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { inSequence } from "@/server/db/sequence";
import {
  aiGenerations,
  approvals,
  auditLogs,
  clients,
  designs,
  files,
  memberships,
  projects,
  requests,
  tasks,
  user,
  workflowStatuses,
} from "@/server/db/schema";
import { assertInternal, can, fileScope, projectScope, taskScope, type Scope } from "@/server/authz";
import { designScope, listDesigns } from "./designs";
import { currentMrr, delinquentClients, expiringContracts } from "./finance";
import { workload } from "./reports";

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
    .where(
      and(
        openTask,
        taskScope(s.actor),
        eq(tasks.assigneeMembershipId, s.actor.membershipId),
        lte(tasks.dueDate, addDays(today, 7)),
      ),
    )
    .orderBy(asc(tasks.dueDate), desc(tasks.priority))
    .limit(30);
  const [noDue] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(
      and(openTask, taskScope(s.actor), eq(tasks.assigneeMembershipId, s.actor.membershipId), isNull(tasks.dueDate)),
    );
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
        fileScope(s.actor),
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
    .where(and(inArray(requests.status, ["submitted", "triage"]), isNull(clients.deletedAt)))
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
        .where(
          and(
            isNull(projects.archivedAt),
            isNull(projects.deletedAt),
            sql`${workflowStatuses.category} not in ('done','cancelled')`,
          ),
        ),
    () =>
      s.db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
        .where(and(openTask, taskScope(s.actor), sql`${tasks.dueDate} < ${today}::date`)),
    () =>
      s.db
        .select({
          internal: sql<number>`count(*) filter (where ${approvals.stage} = 'internal')::int`,
          client: sql<number>`count(*) filter (where ${approvals.stage} = 'client')::int`,
        })
        .from(approvals)
        .innerJoin(files, eq(files.id, approvals.fileId))
        .where(and(eq(approvals.status, "pending"), fileScope(s.actor))),
  );
  const finance = can(s.actor, "finance.read")
    ? {
        mrr: await currentMrr(s),
        delinquent: (await delinquentClients(s)).length,
        expiring: (await expiringContracts(s)).length,
      }
    : null;
  // Carga da semana por pessoa (mesma conta dos Relatórios): quem está acima da capacidade.
  const load = await workload(s, { clientId: undefined });
  // Só quem tem tarefa aberta entra na lista (as 6 pessoas mais carregadas).
  const teamLoad = load
    .filter((r) => r.open > 0)
    .slice(0, 6)
    .map((r) => ({
      membershipId: r.membershipId,
      name: r.name,
      image: r.image,
      roleName: r.roleName,
      open: r.open,
      overdue: r.overdue,
      upcomingMinutes: r.upcomingMinutes,
      capacity: r.capacity,
      load: r.load,
    }));
  const [{ n: team } = { n: 0 }] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.status, "active"));
  return {
    activeProjects: activeProjects?.n ?? 0,
    overdueTasks: overdueTasks?.n ?? 0,
    pendingInternal: pendingApprovals?.internal ?? 0,
    pendingClient: pendingApprovals?.client ?? 0,
    mrrCents: finance?.mrr ?? null,
    /** null = sem permissão financeira. */
    delinquentClients: finance?.delinquent ?? null,
    expiringContracts: finance?.expiring ?? null,
    members: team,
    teamLoad,
    overloaded: load.filter((r) => r.load !== null && r.load > 1).length,
  };
}

function monthStart() {
  return new Date(`${todayISO().slice(0, 7)}-01T00:00:00-03:00`);
}

/** Estúdio: artes recentes (miniaturas reais), carrosséis em andamento e aprovados no mês. */
async function studioOverview(s: Scope) {
  if (!can(s.actor, "designs.read")) return null;
  const recent = await listDesigns(s, { limit: 4 });
  const [row] = await s.db
    .select({
      // Carrossel ainda não exportado = em andamento.
      carousels: sql<number>`count(*) filter (where ${designs.document}->'meta'->>'carousel' = 'true' and ${designs.outputFileId} is null)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(designs)
    .where(and(designScope(s), eq(designs.isTemplate, false), isNull(designs.archivedAt)));
  let approvedThisMonth: number | null = null;
  if (can(s.actor, "files.read")) {
    const [a] = await s.db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvals)
      .innerJoin(files, eq(files.id, approvals.fileId))
      .where(
        and(
          eq(approvals.stage, "client"),
          eq(approvals.status, "approved"),
          sql`${approvals.decidedAt} >= ${monthStart()}`,
          fileScope(s.actor),
        ),
      );
    approvedThisMonth = a?.n ?? 0;
  }
  return { recent, carouselsInProgress: row?.carousels ?? 0, designs: row?.total ?? 0, approvedThisMonth };
}

/**
 * Projetos recentes pela última atividade real (projeto, tarefas ou artes),
 * com a miniatura da arte mais recente do projeto, quando houver.
 */
async function recentProjects(s: Scope) {
  if (!can(s.actor, "projects.read")) return [];
  const lastActivity = sql<Date>`greatest(
    ${projects.updatedAt},
    coalesce((select max(t.updated_at) from ${tasks} t where t.project_id = ${projects.id}), ${projects.updatedAt}),
    coalesce((select max(d.updated_at) from ${designs} d where d.project_id = ${projects.id} and d.deleted_at is null), ${projects.updatedAt})
  )`;
  return s.db
    .select({
      id: projects.id,
      name: projects.name,
      clientName: clients.name,
      dueDate: projects.dueDate,
      statusName: workflowStatuses.name,
      statusColor: workflowStatuses.color,
      lastActivity,
      openTasks: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id} and t.completed_at is null and t.archived_at is null and t.deleted_at is null)`,
      designCount: sql<number>`(select count(*)::int from ${designs} d where d.project_id = ${projects.id} and d.deleted_at is null and d.archived_at is null and d.is_template = false)`,
      thumbnail: sql<
        string | null
      >`(select d.thumbnail from ${designs} d where d.project_id = ${projects.id} and d.deleted_at is null and d.archived_at is null and d.thumbnail is not null order by d.updated_at desc limit 1)`,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, projects.statusId))
    .where(and(projectScope(s.actor), isNull(projects.archivedAt), isNull(projects.deletedAt)))
    .orderBy(desc(lastActivity))
    .limit(6);
}

/** Prazos de projetos nos próximos 14 dias (agenda do painel). */
async function projectDeadlines(s: Scope) {
  if (!can(s.actor, "projects.read")) return [];
  const today = todayISO();
  return s.db
    .select({ id: projects.id, name: projects.name, clientName: clients.name, dueDate: projects.dueDate })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, projects.statusId))
    .where(
      and(
        projectScope(s.actor),
        isNull(projects.archivedAt),
        isNull(projects.deletedAt),
        sql`${workflowStatuses.category} not in ('done','cancelled')`,
        sql`${projects.dueDate} between ${today}::date and ${addDays(today, 14)}::date`,
      ),
    )
    .orderBy(asc(projects.dueDate))
    .limit(6);
}

/** Gerações de IA da pessoa no mês (textos e imagens). */
async function aiThisMonth(s: Scope) {
  if (!can(s.actor, "ai.use")) return null;
  const [row] = await s.db
    .select({
      total: sql<number>`count(*)::int`,
      images: sql<number>`count(*) filter (where ${aiGenerations.kind} = 'image')::int`,
    })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.userId, s.actor.userId), sql`${aiGenerations.createdAt} >= ${monthStart()}`));
  return { total: row?.total ?? 0, images: row?.images ?? 0 };
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
  const [studio, projectsRecent, deadlines, ai] = await inSequence(
    () => studioOverview(s),
    () => recentProjects(s),
    () => projectDeadlines(s),
    () => aiThisMonth(s),
  );
  return {
    tasks: tasksMine,
    approvals: waiting,
    requests: triage,
    projectsAtRisk: risk,
    activity,
    kpis,
    studio,
    recentProjects: projectsRecent,
    deadlines,
    ai,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
