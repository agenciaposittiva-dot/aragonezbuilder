import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { z } from "zod";
import { checklistItemInput, taskInput, taskListParams, taskMoveInput, taskUpdateInput } from "@/lib/validators/tasks";
import {
  approvals,
  auditLogs,
  clients,
  designs,
  domainEvents,
  files,
  memberships,
  projects,
  projectStages,
  requests,
  taskChecklistItems,
  taskCollaborators,
  taskDependencies,
  tasks,
  timeEntries,
  user,
  workflowStatuses,
} from "@/server/db/schema";
import { eachInSequence } from "@/server/db/sequence";
import {
  assertCan,
  assertInternal,
  assertProjectAccess,
  assertTaskAccess,
  can,
  taskScope,
  type Scope,
} from "@/server/authz";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { diff, recordActivity } from "./activity";
import { assertActiveMembers } from "./members";
import { assertTransition, getDefaultStatus, getStatus, type StatusRow } from "./workflow";

const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Distância padrão entre cartões no Kanban (posição fracionária). */
const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

/** Evento de domínio extra (sem registro de auditoria correspondente). */
async function emit(s: Scope, type: string, entityId: string, payload: Record<string, unknown>) {
  await s.db.insert(domainEvents).values({
    organizationId: s.actor.orgId,
    type,
    entityType: "task",
    entityId,
    actorUserId: s.actor.userId,
    payload,
  });
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

const assigneeUser = aliasedTable(user, "assignee_user");

export async function listTasks(s: Scope, raw: z.input<typeof taskListParams>) {
  assertCan(s.actor, "tasks.read");
  const p = taskListParams.parse(raw);
  const assignee =
    p.assignee === "me"
      ? eq(tasks.assigneeMembershipId, s.actor.membershipId)
      : p.assignee === "none"
        ? isNull(tasks.assigneeMembershipId)
        : p.assignee
          ? eq(tasks.assigneeMembershipId, p.assignee)
          : undefined;

  const where = and(
    taskScope(s.actor),
    p.archived ? isNotNull(tasks.archivedAt) : isNull(tasks.archivedAt),
    p.subtasks ? undefined : isNull(tasks.parentTaskId),
    p.projectId ? eq(tasks.projectId, p.projectId) : undefined,
    p.clientId ? eq(projects.clientId, p.clientId) : undefined,
    p.statusId ? eq(tasks.statusId, p.statusId) : undefined,
    p.priority ? eq(tasks.priority, p.priority) : undefined,
    p.from ? gte(tasks.dueDate, p.from) : undefined,
    p.to ? lte(tasks.dueDate, p.to) : undefined,
    p.q ? ilike(tasks.title, ESC(p.q)) : undefined,
    assignee,
  );

  const query = s.db
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
      position: tasks.position,
      estimateMinutes: tasks.estimateMinutes,
      parentTaskId: tasks.parentTaskId,
      statusId: workflowStatuses.id,
      statusName: workflowStatuses.name,
      statusColor: workflowStatuses.color,
      statusCategory: workflowStatuses.category,
      projectId: projects.id,
      projectName: projects.name,
      clientId: clients.id,
      clientName: clients.name,
      assigneeMembershipId: tasks.assigneeMembershipId,
      assigneeName: assigneeUser.name,
      assigneeImage: assigneeUser.image,
      subtasksTotal: sql<number>`(select count(*)::int from ${tasks} st where st.parent_task_id = ${tasks.id} and st.archived_at is null)`,
      subtasksDone: sql<number>`(select count(*)::int from ${tasks} st where st.parent_task_id = ${tasks.id} and st.archived_at is null and st.completed_at is not null)`,
      checklistTotal: sql<number>`(select count(*)::int from ${taskChecklistItems} ci where ci.task_id = ${tasks.id})`,
      checklistDone: sql<number>`(select count(*)::int from ${taskChecklistItems} ci where ci.task_id = ${tasks.id} and ci.done)`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .leftJoin(memberships, eq(memberships.id, tasks.assigneeMembershipId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, memberships.userId))
    .where(where);

  if (p.view === "list") {
    const rows = await query
      .orderBy(asc(workflowStatuses.position), sql`${tasks.dueDate} asc nulls last`, asc(tasks.position))
      .limit(p.pageSize)
      .offset((p.page - 1) * p.pageSize);
    const [total] = await s.db
      .select({ n: count() })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(where);
    return { rows, total: total?.n ?? 0, page: p.page, pageSize: p.pageSize };
  }
  const rows = await query.orderBy(asc(tasks.position), asc(tasks.createdAt)).limit(500);
  return { rows, total: rows.length, page: 1, pageSize: rows.length };
}

export type TaskListRow = Awaited<ReturnType<typeof listTasks>>["rows"][number];

export async function getTask(s: Scope, id: string) {
  assertCan(s.actor, "tasks.read");
  await assertTaskAccess(s, id);
  const [row] = await s.db
    .select({
      task: tasks,
      status: workflowStatuses,
      projectName: projects.name,
      clientId: projects.clientId,
      clientName: clients.name,
      parentTitle: sql<string | null>`(select p.title from ${tasks} p where p.id = ${tasks.parentTaskId})`,
      requestNumber: requests.number,
      requestTitle: requests.title,
      assigneeName: assigneeUser.name,
      assigneeImage: assigneeUser.image,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .leftJoin(requests, eq(requests.id, tasks.requestId))
    .leftJoin(memberships, eq(memberships.id, tasks.assigneeMembershipId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, memberships.userId))
    .where(eq(tasks.id, id));
  if (!row) throw new NotFoundError("Tarefa não encontrada.");

  const collaborators = await s.db
    .select({ membershipId: taskCollaborators.membershipId, name: user.name, image: user.image })
    .from(taskCollaborators)
    .innerJoin(memberships, eq(memberships.id, taskCollaborators.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(taskCollaborators.taskId, id))
    .orderBy(asc(user.name));

  const checklist = await s.db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, id))
    .orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.createdAt));

  const subtasks = await s.db
    .select({
      id: tasks.id,
      title: tasks.title,
      completedAt: tasks.completedAt,
      dueDate: tasks.dueDate,
      statusName: workflowStatuses.name,
      statusColor: workflowStatuses.color,
      statusCategory: workflowStatuses.category,
      assigneeName: assigneeUser.name,
      assigneeImage: assigneeUser.image,
    })
    .from(tasks)
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .leftJoin(memberships, eq(memberships.id, tasks.assigneeMembershipId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, memberships.userId))
    .where(and(eq(tasks.parentTaskId, id), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.position), asc(tasks.createdAt));

  const dependsOn = await s.db
    .select({
      id: tasks.id,
      title: tasks.title,
      completedAt: tasks.completedAt,
      statusName: workflowStatuses.name,
      statusColor: workflowStatuses.color,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(eq(taskDependencies.taskId, id))
    .orderBy(asc(tasks.title));

  const blocking = await s.db
    .select({
      id: tasks.id,
      title: tasks.title,
      completedAt: tasks.completedAt,
      statusName: workflowStatuses.name,
      statusColor: workflowStatuses.color,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(eq(taskDependencies.dependsOnTaskId, id))
    .orderBy(asc(tasks.title));

  const stages = await s.db
    .select({ id: projectStages.id, name: projectStages.name })
    .from(projectStages)
    .where(eq(projectStages.projectId, row.task.projectId))
    .orderBy(asc(projectStages.position));

  const [time] = await s.db
    .select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
    .from(timeEntries)
    .where(eq(timeEntries.taskId, id));

  return {
    task: row.task,
    status: row.status,
    projectName: row.projectName,
    clientId: row.clientId,
    clientName: row.clientName,
    parentTitle: row.parentTitle,
    request: row.task.requestId ? { id: row.task.requestId, number: row.requestNumber, title: row.requestTitle } : null,
    assigneeName: row.assigneeName,
    assigneeImage: row.assigneeImage,
    collaborators,
    checklist,
    subtasks,
    dependsOn,
    blocking,
    stages,
    trackedMinutes: time?.minutes ?? 0,
  };
}

export type TaskDetail = Awaited<ReturnType<typeof getTask>>;

/** Tarefas do mesmo projeto (para escolher dependências e tarefa-mãe). */
export async function projectTaskOptions(s: Scope, projectId: string, excludeId?: string) {
  await assertProjectAccess(s, projectId);
  return s.db
    .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
    .from(tasks)
    .where(
      and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt), excludeId ? ne(tasks.id, excludeId) : undefined),
    )
    .orderBy(asc(tasks.title))
    .limit(500);
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

async function nextPosition(s: Scope, statusId: string) {
  const [row] = await s.db
    .select({ max: sql<number | null>`max(${tasks.position})` })
    .from(tasks)
    .where(eq(tasks.statusId, statusId));
  return (row?.max ?? 0) + POSITION_STEP;
}

/** Confere se o responsável pode ser definido por este ator. */
function assertCanAssign(s: Scope, assigneeId: string | null | undefined) {
  if (assigneeId && assigneeId !== s.actor.membershipId && !can(s.actor, "tasks.assign")) {
    throw new ForbiddenError("Você não tem permissão para atribuir tarefas a outras pessoas.");
  }
}

async function projectInfo(s: Scope, projectId: string) {
  const [p] = await s.db
    .select({ id: projects.id, clientId: projects.clientId, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!p) throw new NotFoundError("Projeto não encontrado.");
  return p;
}

export async function createTask(s: Scope, raw: z.input<typeof taskInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = taskInput.parse(raw);
  await assertProjectAccess(s, data.projectId);
  assertCanAssign(s, data.assigneeMembershipId);
  await assertActiveMembers(s, [data.assigneeMembershipId, ...data.collaboratorIds]);

  if (data.parentTaskId) {
    const parent = await assertTaskAccess(s, data.parentTaskId);
    if (parent.projectId !== data.projectId) throw new ValidationError("A subtarefa deve pertencer ao mesmo projeto.");
  }
  if (data.stageId) {
    const [stage] = await s.db
      .select({ id: projectStages.id })
      .from(projectStages)
      .where(and(eq(projectStages.id, data.stageId), eq(projectStages.projectId, data.projectId)));
    if (!stage) throw new ValidationError("Etapa inválida para este projeto.");
  }
  if (data.requestId) {
    const [req] = await s.db.select({ id: requests.id }).from(requests).where(eq(requests.id, data.requestId));
    if (!req) throw new ValidationError("Solicitação inválida.");
  }

  const status = data.statusId ? await getStatus(s, "task", data.statusId) : await getDefaultStatus(s, "task");
  const project = await projectInfo(s, data.projectId);

  const [row] = await s.db
    .insert(tasks)
    .values({
      organizationId: s.actor.orgId,
      projectId: data.projectId,
      parentTaskId: data.parentTaskId,
      stageId: data.stageId,
      requestId: data.requestId,
      title: data.title,
      description: data.description,
      statusId: status.id,
      priority: data.priority,
      assigneeMembershipId: data.assigneeMembershipId,
      startDate: data.startDate,
      dueDate: data.dueDate,
      estimateMinutes: data.estimateMinutes,
      position: await nextPosition(s, status.id),
      completedAt: status.category === "done" ? new Date() : null,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: tasks.id });
  const id = row!.id;

  const collaborators = [...new Set(data.collaboratorIds)].filter((m) => m !== data.assigneeMembershipId);
  if (collaborators.length) {
    await s.db
      .insert(taskCollaborators)
      .values(collaborators.map((membershipId) => ({ organizationId: s.actor.orgId, taskId: id, membershipId })));
  }

  await recordActivity(s, {
    action: "created",
    entityType: "task",
    entityId: id,
    summary: data.parentTaskId ? `Subtarefa criada: ${data.title}` : `Tarefa criada: ${data.title}`,
    event: {
      payload: {
        taskId: id,
        projectId: data.projectId,
        clientId: project.clientId,
        title: data.title,
        assigneeMembershipId: data.assigneeMembershipId,
        priority: data.priority,
        dueDate: data.dueDate,
      },
    },
  });
  if (data.assigneeMembershipId) {
    await emit(s, "task.assigned", id, {
      taskId: id,
      projectId: data.projectId,
      title: data.title,
      assigneeMembershipId: data.assigneeMembershipId,
      previousAssigneeMembershipId: null,
    });
  }
  return { id };
}

/** Atualização parcial: apenas as chaves presentes na entrada são alteradas. */
export async function updateTask(s: Scope, raw: z.input<typeof taskUpdateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = taskUpdateInput.parse(raw);
  const present = (k: keyof typeof data) => Object.prototype.hasOwnProperty.call(raw, k);
  await assertTaskAccess(s, data.id);
  const [before] = await s.db.select().from(tasks).where(eq(tasks.id, data.id));
  if (!before) throw new NotFoundError("Tarefa não encontrada.");

  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (present("title") && data.title) patch.title = data.title;
  if (present("description")) patch.description = data.description ?? null;
  if (present("priority") && data.priority) patch.priority = data.priority;
  if (present("startDate")) patch.startDate = data.startDate ?? null;
  if (present("dueDate")) patch.dueDate = data.dueDate ?? null;
  if (present("estimateMinutes")) patch.estimateMinutes = data.estimateMinutes ?? null;
  if (present("stageId")) {
    if (data.stageId) {
      const [stage] = await s.db
        .select({ id: projectStages.id })
        .from(projectStages)
        .where(and(eq(projectStages.id, data.stageId), eq(projectStages.projectId, before.projectId)));
      if (!stage) throw new ValidationError("Etapa inválida para este projeto.");
    }
    patch.stageId = data.stageId ?? null;
  }
  if (present("assigneeMembershipId")) {
    const next = data.assigneeMembershipId ?? null;
    if (next !== before.assigneeMembershipId) {
      if (
        !can(s.actor, "tasks.assign") &&
        !(next === s.actor.membershipId || (next === null && before.assigneeMembershipId === s.actor.membershipId))
      ) {
        throw new ForbiddenError("Você não tem permissão para atribuir tarefas a outras pessoas.");
      }
      await assertActiveMembers(s, [next]);
    }
    patch.assigneeMembershipId = next;
  }

  const start = patch.startDate !== undefined ? patch.startDate : before.startDate;
  const due = patch.dueDate !== undefined ? patch.dueDate : before.dueDate;
  if (start && due && start > due) {
    throw new ValidationError("O prazo deve ser depois do início", { dueDate: ["O prazo deve ser depois do início"] });
  }

  const changes = diff(before, patch);
  if (!Object.keys(changes).length) return;
  await s.db.update(tasks).set(patch).where(eq(tasks.id, data.id));

  const assigneeChanged = "assigneeMembershipId" in changes;
  await recordActivity(s, {
    action: "updated",
    entityType: "task",
    entityId: data.id,
    summary: assigneeChanged && Object.keys(changes).length === 1 ? "Responsável alterado" : "Tarefa atualizada",
    changes,
    event: false,
  });
  if (assigneeChanged && patch.assigneeMembershipId) {
    await emit(s, "task.assigned", data.id, {
      taskId: data.id,
      projectId: before.projectId,
      title: patch.title ?? before.title,
      assigneeMembershipId: patch.assigneeMembershipId,
      previousAssigneeMembershipId: before.assigneeMembershipId,
    });
  }
}

/** Dependências pendentes impedem a conclusão. */
async function assertDependenciesDone(s: Scope, taskId: string) {
  const pending = await s.db
    .select({ title: tasks.title })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(and(eq(taskDependencies.taskId, taskId), isNull(tasks.completedAt)));
  if (pending.length) {
    const names = pending.map((p) => `"${p.title}"`).join(", ");
    throw new ValidationError(`Conclua antes as tarefas de que esta depende: ${names}.`);
  }
}

/** Aplica a troca de status (transição, dependências, conclusão, eventos). */
async function applyStatus(
  s: Scope,
  before: typeof tasks.$inferSelect,
  to: StatusRow,
  extra: Partial<typeof tasks.$inferInsert> = {},
) {
  const from = await getStatus(s, "task", before.statusId);
  await assertTransition(s, from.id, to.id);
  if (to.category === "done" && from.category !== "done") await assertDependenciesDone(s, before.id);

  const completedAt = to.category === "done" ? (before.completedAt ?? new Date()) : null;
  await s.db
    .update(tasks)
    .set({ statusId: to.id, completedAt, ...extra })
    .where(eq(tasks.id, before.id));

  if (from.id === to.id) return;
  await recordActivity(s, {
    action: "status_changed",
    entityType: "task",
    entityId: before.id,
    summary: `Status: ${from.name} → ${to.name}`,
    changes: { status: { from: from.name, to: to.name } },
    event: {
      payload: {
        taskId: before.id,
        projectId: before.projectId,
        title: before.title,
        fromStatus: from.key,
        toStatus: to.key,
        toCategory: to.category,
        assigneeMembershipId: before.assigneeMembershipId,
      },
    },
  });
  if (to.category === "done" && from.category !== "done") {
    await emit(s, "task.completed", before.id, {
      taskId: before.id,
      projectId: before.projectId,
      title: before.title,
      assigneeMembershipId: before.assigneeMembershipId,
    });
  }
}

export async function changeTaskStatus(s: Scope, taskId: string, statusId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  const [before] = await s.db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!before) throw new NotFoundError("Tarefa não encontrada.");
  if (before.statusId === statusId) return;
  const to = await getStatus(s, "task", statusId);
  await applyStatus(s, before, to, { position: await nextPosition(s, to.id) });
}

/** Marca como concluída (status padrão da categoria "concluído") ou reabre. */
export async function toggleTaskDone(s: Scope, taskId: string, done: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  const [before] = await s.db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!before) throw new NotFoundError("Tarefa não encontrada.");
  const statuses = await s.db
    .select()
    .from(workflowStatuses)
    .where(eq(workflowStatuses.entity, "task"))
    .orderBy(asc(workflowStatuses.position));
  const target = done
    ? statuses.find((st) => st.category === "done")
    : (statuses.find((st) => st.isDefault) ?? statuses.find((st) => st.category === "todo"));
  if (!target) throw new ValidationError("Nenhum status configurado para esta ação.");
  if (target.id === before.statusId) return;
  await applyStatus(s, before, target, { position: await nextPosition(s, target.id) });
}

/** Renumera as posições de uma coluna quando o espaço entre cartões acaba. */
async function rebalance(s: Scope, statusId: string) {
  const rows = await s.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.statusId, statusId))
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
  await eachInSequence(rows, (r, i) =>
    s.db
      .update(tasks)
      .set({ position: (i + 1) * POSITION_STEP })
      .where(eq(tasks.id, r.id)),
  );
}

async function positionOf(s: Scope, id: string | null | undefined, statusId: string) {
  if (!id) return null;
  const [row] = await s.db
    .select({ position: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.statusId, statusId)));
  return row?.position ?? null;
}

async function computePosition(s: Scope, statusId: string, beforeId?: string | null, afterId?: string | null) {
  const before = await positionOf(s, beforeId, statusId);
  const after = await positionOf(s, afterId, statusId);
  if (before !== null && after !== null) {
    if (after - before < MIN_GAP) return null;
    return (before + after) / 2;
  }
  if (before !== null) return before + POSITION_STEP;
  if (after !== null) return after - POSITION_STEP;
  return nextPosition(s, statusId);
}

/** Movimento no Kanban: muda status (se for o caso) e posição entre vizinhos. */
export async function moveTask(s: Scope, raw: z.input<typeof taskMoveInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = taskMoveInput.parse(raw);
  await assertTaskAccess(s, data.id);
  const [before] = await s.db.select().from(tasks).where(eq(tasks.id, data.id));
  if (!before) throw new NotFoundError("Tarefa não encontrada.");
  const to = await getStatus(s, "task", data.statusId);

  let position = await computePosition(s, to.id, data.beforeId, data.afterId);
  if (position === null) {
    await rebalance(s, to.id);
    position = (await computePosition(s, to.id, data.beforeId, data.afterId)) ?? (await nextPosition(s, to.id));
  }

  if (before.statusId === to.id) {
    await s.db.update(tasks).set({ position }).where(eq(tasks.id, data.id));
    return { position };
  }
  await applyStatus(s, before, to, { position });
  return { position };
}

export async function setTaskArchived(s: Scope, taskId: string, archived: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  await s.db
    .update(tasks)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(tasks.id, taskId));
  await recordActivity(s, {
    action: archived ? "archived" : "restored",
    entityType: "task",
    entityId: taskId,
    summary: archived ? "Tarefa arquivada" : "Tarefa restaurada",
    event: false,
  });
}

/** Exclusão definitiva. Arquivos, aprovações e artes vinculados são preservados e desvinculados. */
export async function deleteTask(s: Scope, taskId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.delete");
  const access = await assertTaskAccess(s, taskId);
  const [row] = await s.db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, taskId));
  // Subtarefas são excluídas em cascata: desvincula os registros delas também.
  const ids = [
    taskId,
    ...(await s.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentTaskId, taskId))).map((r) => r.id),
  ];
  await s.db.update(files).set({ taskId: null }).where(inArray(files.taskId, ids));
  await s.db.update(approvals).set({ taskId: null }).where(inArray(approvals.taskId, ids));
  await s.db.update(designs).set({ taskId: null }).where(inArray(designs.taskId, ids));
  await s.db.delete(tasks).where(eq(tasks.id, taskId));
  await recordActivity(s, {
    action: "deleted",
    entityType: "project",
    entityId: access.projectId,
    summary: `Tarefa excluída: ${row?.title ?? ""}`,
    event: false,
  });
}

export async function setTaskCollaborators(s: Scope, taskId: string, membershipIds: string[]) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  const ids = [...new Set(membershipIds)];
  await assertActiveMembers(s, ids);
  await s.db.delete(taskCollaborators).where(eq(taskCollaborators.taskId, taskId));
  if (ids.length) {
    await s.db
      .insert(taskCollaborators)
      .values(ids.map((membershipId) => ({ organizationId: s.actor.orgId, taskId, membershipId })));
  }
  await recordActivity(s, {
    action: "collaborators_updated",
    entityType: "task",
    entityId: taskId,
    summary: "Colaboradores atualizados",
    event: false,
  });
}

/* Checklist ---------------------------------------------------------- */

export async function saveChecklistItem(s: Scope, raw: z.input<typeof checklistItemInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = checklistItemInput.parse(raw);
  await assertTaskAccess(s, data.taskId);
  if (data.id) {
    const res = await s.db
      .update(taskChecklistItems)
      .set({ title: data.title })
      .where(and(eq(taskChecklistItems.id, data.id), eq(taskChecklistItems.taskId, data.taskId)))
      .returning({ id: taskChecklistItems.id });
    if (!res.length) throw new NotFoundError("Item não encontrado.");
    return { id: data.id };
  }
  const [{ max } = { max: -1 }] = await s.db
    .select({ max: sql<number>`coalesce(max(${taskChecklistItems.position}), -1)::int` })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, data.taskId));
  const [row] = await s.db
    .insert(taskChecklistItems)
    .values({ organizationId: s.actor.orgId, taskId: data.taskId, title: data.title, position: max + 1 })
    .returning({ id: taskChecklistItems.id });
  return { id: row!.id };
}

export async function toggleChecklistItem(s: Scope, taskId: string, itemId: string, done: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  const res = await s.db
    .update(taskChecklistItems)
    .set({ done, doneAt: done ? new Date() : null })
    .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId)))
    .returning({ id: taskChecklistItems.id });
  if (!res.length) throw new NotFoundError("Item não encontrado.");
}

export async function deleteChecklistItem(s: Scope, taskId: string, itemId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  await s.db
    .delete(taskChecklistItems)
    .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId)));
}

export async function reorderChecklist(s: Scope, taskId: string, orderedIds: string[]) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  await eachInSequence(orderedIds, (id, position) =>
    s.db
      .update(taskChecklistItems)
      .set({ position })
      .where(and(eq(taskChecklistItems.id, id), eq(taskChecklistItems.taskId, taskId))),
  );
}

/* Dependências ------------------------------------------------------- */

/** Verifica se `dependsOnId` já depende (direta ou indiretamente) de `taskId`. */
async function createsCycle(s: Scope, taskId: string, dependsOnId: string) {
  const result = await s.db.execute<{ found: boolean }>(sql`
    with recursive chain(id) as (
      select depends_on_task_id from ${taskDependencies} where task_id = ${dependsOnId}
      union
      select d.depends_on_task_id from ${taskDependencies} d join chain c on d.task_id = c.id
    )
    select exists(select 1 from chain where id = ${taskId}) as found
  `);
  return Boolean(result.rows[0]?.found);
}

export async function addDependency(s: Scope, taskId: string, dependsOnTaskId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  if (taskId === dependsOnTaskId) throw new ValidationError("Uma tarefa não pode depender de si mesma.");
  const a = await assertTaskAccess(s, taskId);
  const b = await assertTaskAccess(s, dependsOnTaskId);
  if (a.projectId !== b.projectId) throw new ValidationError("Dependências devem estar no mesmo projeto.");
  if (await createsCycle(s, taskId, dependsOnTaskId)) {
    throw new ValidationError("Esta dependência criaria um ciclo (uma tarefa esperando pela outra).");
  }
  await s.db
    .insert(taskDependencies)
    .values({ organizationId: s.actor.orgId, taskId, dependsOnTaskId })
    .onConflictDoNothing();
  await recordActivity(s, {
    action: "dependency_added",
    entityType: "task",
    entityId: taskId,
    summary: "Dependência adicionada",
    event: false,
  });
}

export async function removeDependency(s: Scope, taskId: string, dependsOnTaskId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  await s.db
    .delete(taskDependencies)
    .where(and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnTaskId, dependsOnTaskId)));
}

/* Histórico ---------------------------------------------------------- */

export async function taskHistory(s: Scope, taskId: string, limit = 80) {
  assertCan(s.actor, "tasks.read");
  await assertTaskAccess(s, taskId);
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
    .where(and(eq(auditLogs.entityType, "task"), eq(auditLogs.entityId, taskId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
