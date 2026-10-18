"use client";

import { useMemo } from "react";
import { KanbanBoard, type KanbanColumn } from "@/components/app/kanban-board";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { moveTaskAction } from "@/server/actions/tasks";
import type { TaskListRow } from "@/server/services/tasks";
import { QuickAddTask } from "./quick-add-task";
import { TaskCard } from "./task-card";
import type { ProjectOption } from "./task-form-dialog";

/** Quadro de tarefas: colunas = status do fluxo; arrastar muda status e ordem (persistente). */
export function TasksBoard({
  statuses,
  rows,
  canWrite,
  projectId,
  projects,
  assigneeMembershipId,
}: {
  statuses: { id: string; name: string; color: string }[];
  rows: TaskListRow[];
  canWrite: boolean;
  projectId?: string;
  projects?: ProjectOption[];
  assigneeMembershipId?: string;
}) {
  const { orgSlug } = useWorkspace();
  const move = useOrgAction(moveTaskAction);
  const columns: KanbanColumn[] = useMemo(
    () =>
      statuses.map((s) => ({
        id: s.id,
        title: s.name,
        color: s.color,
        footer: canWrite ? (
          <QuickAddTask
            statusId={s.id}
            projectId={projectId}
            projects={projects}
            assigneeMembershipId={assigneeMembershipId}
          />
        ) : undefined,
      })),
    [statuses, canWrite, projectId, projects, assigneeMembershipId],
  );
  const items = useMemo(() => rows.map((r) => ({ ...r, columnId: r.statusId })), [rows]);

  return (
    <KanbanBoard
      columns={columns}
      items={items}
      emptyLabel="Nenhuma tarefa"
      onMove={async ({ item, toColumnId, beforeId, afterId }) => {
        if (!canWrite) return false;
        const res = await move.run({ id: item.id, statusId: toColumnId, beforeId, afterId });
        return res.ok;
      }}
      renderCard={(t, { dragging }) => (
        <TaskCard task={t} href={`/w/${orgSlug}/tasks/${t.id}`} dragging={dragging} hideProject={!!projectId} />
      )}
    />
  );
}
