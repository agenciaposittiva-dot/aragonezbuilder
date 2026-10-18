import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_STAGES,
  projectInput,
  projectListParams,
  projectUpdateInput,
  stageInput,
} from "@/lib/validators/projects";
import {
  auditLogs,
  clients,
  expenses,
  invoices,
  memberships,
  projectMembers,
  projects,
  projectStages,
  tasks,
  timeEntries,
  user,
  workflowStatuses,
} from "@/server/db/schema";
import {
  assertCan,
  assertClientAccess,
  assertInternal,
  assertProjectAccess,
  can,
  projectScope,
  type Scope,
} from "@/server/authz";
import { inSequence, eachInSequence } from "@/server/db/sequence";
import { NotFoundError, ValidationError } from "@/server/errors";
import { diff, recordActivity } from "./activity";
import { assertActiveMembers } from "./members";
import { assertTransition, getDefaultStatus, getStatus } from "./workflow";

const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listProjects(s: Scope, raw: z.input<typeof projectListParams>) {
  assertCan(s.actor, "projects.read");
  const p = projectListParams.parse(raw);
  const where = and(
    projectScope(s.actor),
    p.archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt),
    p.clientId ? eq(projects.clientId, p.clientId) : undefined,
    p.statusId ? eq(projects.statusId, p.statusId) : undefined,
    p.ownerId ? eq(projects.ownerMembershipId, p.ownerId) : undefined,
    p.priority ? eq(projects.priority, p.priority) : undefined,
    p.from ? or(gte(projects.dueDate, p.from), isNull(projects.dueDate)) : undefined,
    p.to ? or(lte(projects.startDate, p.to), isNull(projects.startDate)) : undefined,
    p.q ? ilike(projects.name, ESC(p.q)) : undefined,
  );
  const paginate = p.view === "list";
  const query = s.db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      completedAt: projects.completedAt,
      createdAt: projects.createdAt,
      clientId: clients.id,
      clientName: clients.name,
      statusId: workflowStatuses.id,
      statusName: workflowStatuses.name,
      statusColor: workflowStatuses.color,
      statusCategory: workflowStatuses.category,
      ownerMembershipId: projects.ownerMembershipId,
      ownerName: user.name,
      ownerImage: user.image,
      tasksTotal: sql<number>`(select count(*)::int from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.archivedAt} is null and ${tasks.parentTaskId} is null)`,
      tasksDone: sql<number>`(select count(*)::int from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.archivedAt} is null and ${tasks.parentTaskId} is null and ${tasks.completedAt} is not null)`,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, projects.statusId))
    .leftJoin(memberships, eq(memberships.id, projects.ownerMembershipId))
    .leftJoin(user, eq(user.id, memberships.userId))
    .where(where)
    .orderBy(asc(workflowStatuses.position), sql`${projects.dueDate} asc nulls last`, desc(projects.createdAt));

  const rows = paginate ? await query.limit(p.pageSize).offset((p.page - 1) * p.pageSize) : await query.limit(500);
  const [total] = await s.db.select({ n: count() }).from(projects).where(where);
  return { rows, total: total?.n ?? 0, page: p.page, pageSize: p.pageSize };
}

export type ProjectListRow = Awaited<ReturnType<typeof listProjects>>["rows"][number];

export async function projectOptions(s: Scope, clientId?: string) {
  return s.db
    .select({
      id: projects.id,
      name: projects.name,
      clientId: projects.clientId,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(projectScope(s.actor), isNull(projects.archivedAt), clientId ? eq(projects.clientId, clientId) : undefined),
    )
    .orderBy(asc(clients.name), asc(projects.name))
    .limit(500);
}

export async function getProject(s: Scope, id: string) {
  assertCan(s.actor, "projects.read");
  await assertProjectAccess(s, id);
  const [row] = await s.db
    .select({
      project: projects,
      clientName: clients.name,
      status: workflowStatuses,
      ownerName: user.name,
      ownerImage: user.image,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, projects.statusId))
    .leftJoin(memberships, eq(memberships.id, projects.ownerMembershipId))
    .leftJoin(user, eq(user.id, memberships.userId))
    .where(eq(projects.id, id));
  if (!row) throw new NotFoundError("Projeto não encontrado.");

  const [members, stages, [taskCounts]] = await inSequence(
    () =>
      s.db
        .select({
          membershipId: projectMembers.membershipId,
          name: user.name,
          image: user.image,
          email: user.email,
        })
        .from(projectMembers)
        .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
        .innerJoin(user, eq(user.id, memberships.userId))
        .where(eq(projectMembers.projectId, id))
        .orderBy(asc(user.name)),
    () => s.db.select().from(projectStages).where(eq(projectStages.projectId, id)).orderBy(asc(projectStages.position)),
    () =>
      s.db
        .select({
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${tasks.completedAt} is not null)::int`,
          overdue: sql<number>`count(*) filter (where ${tasks.completedAt} is null and ${tasks.dueDate} < current_date)::int`,
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, id), isNull(tasks.archivedAt), isNull(tasks.parentTaskId))),
  );

  const isClient = s.actor.kind === "client";
  const showMoney = can(s.actor, "finance.read");
  return {
    project: {
      ...row.project,
      budgetCents: showMoney ? row.project.budgetCents : null,
    },
    clientName: row.clientName,
    status: row.status,
    ownerName: row.ownerName,
    ownerImage: row.ownerImage,
    members: isClient ? [] : members,
    stages,
    tasks: taskCounts ?? { total: 0, done: 0, overdue: 0 },
  };
}

export async function createProject(s: Scope, raw: z.input<typeof projectInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  const data = projectInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  await assertActiveMembers(s, [data.ownerMembershipId, ...data.memberIds]);
  const status = data.statusId ? await getStatus(s, "project", data.statusId) : await getDefaultStatus(s, "project");

  const [row] = await s.db
    .insert(projects)
    .values({
      organizationId: s.actor.orgId,
      clientId: data.clientId,
      name: data.name,
      description: data.description,
      objective: data.objective,
      ownerMembershipId: data.ownerMembershipId ?? s.actor.membershipId,
      statusId: status.id,
      priority: data.priority,
      startDate: data.startDate,
      dueDate: data.dueDate,
      budgetCents: can(s.actor, "finance.write") ? data.budget : null,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: projects.id });
  const id = row!.id;

  const memberIds = [...new Set([data.ownerMembershipId ?? s.actor.membershipId, ...data.memberIds])];
  await s.db.insert(projectMembers).values(
    memberIds.map((membershipId) => ({
      organizationId: s.actor.orgId,
      projectId: id,
      membershipId,
    })),
  );

  const stageNames = data.stages ?? DEFAULT_STAGES;
  if (stageNames.length) {
    await s.db.insert(projectStages).values(
      stageNames.map((name, position) => ({
        organizationId: s.actor.orgId,
        projectId: id,
        name,
        position,
        status: position === 0 ? ("active" as const) : ("pending" as const),
      })),
    );
  }

  await recordActivity(s, {
    action: "created",
    entityType: "project",
    entityId: id,
    summary: `Projeto ${data.name} criado`,
    clientVisible: true,
    event: {
      payload: {
        projectId: id,
        clientId: data.clientId,
        name: data.name,
        ownerMembershipId: data.ownerMembershipId ?? s.actor.membershipId,
      },
    },
  });
  return { id };
}

export async function updateProject(s: Scope, raw: z.input<typeof projectUpdateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  const data = projectUpdateInput.parse(raw);
  await assertProjectAccess(s, data.id);
  await assertActiveMembers(s, [data.ownerMembershipId]);
  const [before] = await s.db.select().from(projects).where(eq(projects.id, data.id));
  if (!before) throw new NotFoundError();

  const patch = {
    name: data.name,
    description: data.description,
    objective: data.objective,
    ownerMembershipId: data.ownerMembershipId,
    priority: data.priority,
    startDate: data.startDate,
    dueDate: data.dueDate,
    ...(data.budget !== undefined && can(s.actor, "finance.write") ? { budgetCents: data.budget } : {}),
  };
  const changes = diff(before, patch);
  if (!Object.keys(changes).length) return;
  await s.db.update(projects).set(patch).where(eq(projects.id, data.id));
  if (data.ownerMembershipId) {
    await s.db
      .insert(projectMembers)
      .values({
        organizationId: s.actor.orgId,
        projectId: data.id,
        membershipId: data.ownerMembershipId,
      })
      .onConflictDoNothing();
  }
  await recordActivity(s, {
    action: "updated",
    entityType: "project",
    entityId: data.id,
    summary: "Projeto atualizado",
    changes,
    event: { payload: { projectId: data.id, changes: Object.keys(changes) } },
  });
}

export async function changeProjectStatus(s: Scope, projectId: string, statusId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  await assertProjectAccess(s, projectId);
  const [before] = await s.db
    .select({
      statusId: projects.statusId,
      name: projects.name,
      clientId: projects.clientId,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!before) throw new NotFoundError();
  if (before.statusId === statusId) return;
  const [from, to] = await inSequence(
    () => getStatus(s, "project", before.statusId),
    () => getStatus(s, "project", statusId),
  );
  await assertTransition(s, from.id, to.id);

  await s.db
    .update(projects)
    .set({
      statusId: to.id,
      completedAt: to.category === "done" ? new Date() : null,
    })
    .where(eq(projects.id, projectId));

  await recordActivity(s, {
    action: "status_changed",
    entityType: "project",
    entityId: projectId,
    summary: `Status: ${from.name} → ${to.name}`,
    changes: { status: { from: from.name, to: to.name } },
    clientVisible: true,
    event: {
      payload: {
        projectId,
        clientId: before.clientId,
        name: before.name,
        fromStatus: from.key,
        toStatus: to.key,
        toCategory: to.category,
      },
    },
  });
}

export async function setProjectArchived(s: Scope, projectId: string, archived: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.archive");
  await assertProjectAccess(s, projectId);
  await s.db
    .update(projects)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(projects.id, projectId));
  await recordActivity(s, {
    action: archived ? "archived" : "restored",
    entityType: "project",
    entityId: projectId,
    summary: archived ? "Projeto arquivado" : "Projeto restaurado",
  });
}

export const projectMembersInput = z.object({
  projectId: z.uuid(),
  membershipIds: z.array(z.uuid()).max(50),
});

export async function setProjectMembers(s: Scope, raw: z.input<typeof projectMembersInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  const data = projectMembersInput.parse(raw);
  await assertProjectAccess(s, data.projectId);
  await assertActiveMembers(s, data.membershipIds);
  const [p] = await s.db
    .select({ owner: projects.ownerMembershipId })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  const ids = [...new Set([...(p?.owner ? [p.owner] : []), ...data.membershipIds])];
  await s.db.delete(projectMembers).where(eq(projectMembers.projectId, data.projectId));
  if (ids.length) {
    await s.db.insert(projectMembers).values(
      ids.map((membershipId) => ({
        organizationId: s.actor.orgId,
        projectId: data.projectId,
        membershipId,
      })),
    );
  }
  await recordActivity(s, {
    action: "team_updated",
    entityType: "project",
    entityId: data.projectId,
    summary: "Equipe do projeto atualizada",
    event: { payload: { projectId: data.projectId, membershipIds: ids } },
  });
}

/* Etapas ------------------------------------------------------------- */

export async function saveStage(s: Scope, raw: z.input<typeof stageInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  const data = stageInput.parse(raw);
  await assertProjectAccess(s, data.projectId);
  if (data.id) {
    const res = await s.db
      .update(projectStages)
      .set({ name: data.name, dueDate: data.dueDate })
      .where(and(eq(projectStages.id, data.id), eq(projectStages.projectId, data.projectId)))
      .returning({ id: projectStages.id });
    if (!res.length) throw new NotFoundError("Etapa não encontrada.");
    return { id: data.id };
  }
  const [{ max } = { max: -1 }] = await s.db
    .select({
      max: sql<number>`coalesce(max(${projectStages.position}), -1)::int`,
    })
    .from(projectStages)
    .where(eq(projectStages.projectId, data.projectId));
  const [row] = await s.db
    .insert(projectStages)
    .values({
      organizationId: s.actor.orgId,
      projectId: data.projectId,
      name: data.name,
      dueDate: data.dueDate,
      position: max + 1,
    })
    .returning({ id: projectStages.id });
  return { id: row!.id };
}

export async function setStageStatus(
  s: Scope,
  projectId: string,
  stageId: string,
  status: "pending" | "active" | "done",
) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  await assertProjectAccess(s, projectId);
  const [stage] = await s.db
    .update(projectStages)
    .set({ status, completedAt: status === "done" ? new Date() : null })
    .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)))
    .returning({ name: projectStages.name, position: projectStages.position });
  if (!stage) throw new NotFoundError("Etapa não encontrada.");

  // Ao concluir uma etapa, a próxima pendente passa a ser a etapa ativa.
  if (status === "done") {
    const [next] = await s.db
      .select({ id: projectStages.id })
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.status, "pending")))
      .orderBy(asc(projectStages.position))
      .limit(1);
    if (next) await s.db.update(projectStages).set({ status: "active" }).where(eq(projectStages.id, next.id));
  }
  await recordActivity(s, {
    action: status === "done" ? "stage_completed" : "stage_updated",
    entityType: "project",
    entityId: projectId,
    summary:
      status === "done"
        ? `Etapa concluída: ${stage.name}`
        : `Etapa "${stage.name}" marcada como ${status === "active" ? "em andamento" : "pendente"}`,
    clientVisible: status === "done",
    event: {
      type: "project.stage_changed",
      payload: { projectId, stageId, status },
    },
  });
}

export async function reorderStages(s: Scope, projectId: string, orderedIds: string[]) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  await assertProjectAccess(s, projectId);
  await eachInSequence(orderedIds, (id, position) =>
    s.db
      .update(projectStages)
      .set({ position })
      .where(and(eq(projectStages.id, id), eq(projectStages.projectId, projectId))),
  );
}

export async function deleteStage(s: Scope, projectId: string, stageId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.write");
  await assertProjectAccess(s, projectId);
  const [inUse] = await s.db.select({ n: count() }).from(tasks).where(eq(tasks.stageId, stageId));
  if ((inUse?.n ?? 0) > 0) throw new ValidationError("Há tarefas nesta etapa. Mova-as antes de excluir.");
  await s.db.delete(projectStages).where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)));
}

/* Rentabilidade e histórico ----------------------------------------- */

/** Receita, custos de horas e despesas do projeto (exige `costs.read`). */
export async function projectFinancials(s: Scope, projectId: string) {
  assertCan(s.actor, "costs.read");
  await assertProjectAccess(s, projectId);
  const [[rev], [time], [exp], [proj]] = await inSequence(
    () =>
      s.db
        .select({
          invoiced: sql<number>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} <> 'cancelled'), 0)::bigint`,
          received: sql<number>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} = 'paid'), 0)::bigint`,
        })
        .from(invoices)
        .where(eq(invoices.projectId, projectId)),
    () =>
      s.db
        .select({
          minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
          cost: sql<number>`coalesce(sum(${timeEntries.costCents}), 0)::bigint`,
        })
        .from(timeEntries)
        .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .where(eq(tasks.projectId, projectId)),
    () =>
      s.db
        .select({
          total: sql<number>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.status} <> 'cancelled'), 0)::bigint`,
        })
        .from(expenses)
        .where(eq(expenses.projectId, projectId)),
    () => s.db.select({ budget: projects.budgetCents }).from(projects).where(eq(projects.id, projectId)),
  );
  const revenue = Number(rev?.invoiced ?? 0);
  const laborCost = Number(time?.cost ?? 0);
  const directCost = Number(exp?.total ?? 0);
  const profit = revenue - laborCost - directCost;
  return {
    budgetCents: proj?.budget ?? null,
    invoicedCents: revenue,
    receivedCents: Number(rev?.received ?? 0),
    minutes: Number(time?.minutes ?? 0),
    laborCostCents: laborCost,
    expensesCents: directCost,
    profitCents: profit,
    margin: revenue > 0 ? profit / revenue : null,
  };
}

export async function projectHistory(s: Scope, projectId: string, limit = 60) {
  assertCan(s.actor, "projects.read");
  await assertProjectAccess(s, projectId);
  const projectTasks = s.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId));
  return s.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      changes: auditLogs.changes,
      createdAt: auditLogs.createdAt,
      actorName: user.name,
      actorImage: user.image,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorUserId))
    .where(
      and(
        or(
          and(eq(auditLogs.entityType, "project"), eq(auditLogs.entityId, projectId)),
          and(eq(auditLogs.entityType, "task"), inArray(auditLogs.entityId, projectTasks)),
        ),
        s.actor.kind === "client" ? eq(auditLogs.clientVisible, true) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
