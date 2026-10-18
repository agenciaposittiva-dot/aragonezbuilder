import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { taskDependencies, tasks, workflowStatuses } from "@/server/db/schema";

/**
 * Tarefas abertas que dependiam da tarefa concluída e não têm mais nenhuma
 * dependência pendente — ou seja, foram liberadas agora. Usada pelo serviço de
 * tarefas e pelo motor de automações (filtra a organização explicitamente).
 */
export async function releasedDependents(db: Tx, orgId: string, completedTaskId: string) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      assigneeMembershipId: tasks.assigneeMembershipId,
      statusCategory: workflowStatuses.category,
    })
    .from(taskDependencies)
    .innerJoin(tasks, and(eq(tasks.id, taskDependencies.taskId), eq(tasks.organizationId, orgId)))
    .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
    .where(
      and(
        eq(taskDependencies.organizationId, orgId),
        eq(taskDependencies.dependsOnTaskId, completedTaskId),
        isNull(tasks.completedAt),
        isNull(tasks.archivedAt),
        sql`not exists (select 1 from ${taskDependencies} d join ${tasks} dep on dep.id = d.depends_on_task_id where d.task_id = ${tasks.id} and dep.completed_at is null and dep.archived_at is null)`,
      ),
    );
}

/** Payload de `task.unblocked` para cada tarefa liberada. */
export function unblockedPayload(
  dep: Awaited<ReturnType<typeof releasedDependents>>[number],
  by: { id: string; title: string },
) {
  return {
    taskId: dep.id,
    projectId: dep.projectId,
    title: dep.title,
    assigneeMembershipId: dep.assigneeMembershipId,
    statusCategory: dep.statusCategory,
    releasedByTaskId: by.id,
    releasedByTitle: by.title,
  };
}
