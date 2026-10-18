"use client";

import Link from "next/link";
import { useMemo } from "react";
import { DueDate } from "@/components/app/due-date";
import { KanbanBoard, type KanbanColumn } from "@/components/app/kanban-board";
import { PriorityIcon } from "@/components/app/priority";
import { Avatar } from "@/components/ui/avatar";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { changeProjectStatusAction } from "@/server/actions/projects";

type Row = {
  id: string;
  name: string;
  clientName: string;
  statusId: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  completedAt: Date | null;
  ownerName: string | null;
  ownerImage: string | null;
  tasksTotal: number;
  tasksDone: number;
};

export function ProjectsBoard({
  statuses,
  rows,
  canMove,
}: {
  statuses: { id: string; name: string; color: string }[];
  rows: Row[];
  canMove: boolean;
}) {
  const { orgSlug } = useWorkspace();
  const move = useOrgAction(changeProjectStatusAction, { success: "Status atualizado" });
  const columns: KanbanColumn[] = useMemo(
    () => statuses.map((s) => ({ id: s.id, title: s.name, color: s.color })),
    [statuses],
  );
  const items = useMemo(() => rows.map((r) => ({ ...r, columnId: r.statusId })), [rows]);

  return (
    <KanbanBoard
      columns={columns}
      items={items}
      emptyLabel="Arraste projetos para cá"
      onMove={async ({ item, toColumnId, fromColumnId }) => {
        if (!canMove) return false;
        if (toColumnId === fromColumnId) return true;
        const res = await move.run({ projectId: item.id, statusId: toColumnId });
        return res.ok;
      }}
      renderCard={(p, { dragging }) => (
        <article
          className={`rounded-lg border border-border bg-surface p-3 shadow-xs transition-shadow hover:border-border-strong ${dragging ? "shadow-lg" : ""}`}
        >
          <Link
            href={`/w/${orgSlug}/projects/${p.id}`}
            className="block text-sm font-medium text-fg hover:underline"
            draggable={false}
          >
            {p.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-fg-muted">{p.clientName}</p>
          {p.tasksTotal ? (
            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round((p.tasksDone / p.tasksTotal) * 100)}%` }}
                />
              </div>
              <span className="tabular text-[11px] text-fg-subtle">
                {p.tasksDone}/{p.tasksTotal}
              </span>
            </div>
          ) : null}
          <div className="mt-2.5 flex items-center gap-2">
            <PriorityIcon priority={p.priority} />
            <DueDate date={p.dueDate} done={!!p.completedAt} />
            <span className="flex-1" />
            {p.ownerName ? <Avatar name={p.ownerName} src={p.ownerImage} size="xs" /> : null}
          </div>
        </article>
      )}
    />
  );
}
