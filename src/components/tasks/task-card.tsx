import { CheckSquare, ListTree } from "lucide-react";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { PriorityIcon } from "@/components/app/priority";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { LabelList } from "./task-labels";

export type TaskCardData = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  completedAt: Date | null;
  projectName: string;
  clientName: string;
  assigneeName: string | null;
  assigneeImage: string | null;
  subtasksTotal: number;
  subtasksDone: number;
  checklistTotal: number;
  checklistDone: number;
  labels?: { id: string; name: string; color: string }[];
};

export function TaskCard({
  task,
  href,
  dragging,
  hideProject,
}: {
  task: TaskCardData;
  href: string;
  dragging?: boolean;
  hideProject?: boolean;
}) {
  return (
    <article
      className={cn(
        "rounded-lg border border-border bg-surface p-3 shadow-xs transition-shadow hover:border-border-strong",
        dragging && "shadow-lg",
      )}
    >
      <Link
        href={href}
        draggable={false}
        className={cn(
          "block text-sm leading-snug font-medium text-fg hover:underline",
          task.completedAt && "text-fg-subtle line-through",
        )}
      >
        {task.title}
      </Link>
      {hideProject ? null : (
        <p className="mt-0.5 truncate text-xs text-fg-muted">
          {task.clientName} · {task.projectName}
        </p>
      )}
      {task.labels?.length ? (
        <div className="mt-1.5">
          <LabelList labels={task.labels} />
        </div>
      ) : null}
      <div className="mt-2.5 flex items-center gap-2.5">
        <PriorityIcon priority={task.priority} />
        <DueDate date={task.dueDate} done={!!task.completedAt} />
        {task.checklistTotal ? (
          <span className="tabular inline-flex items-center gap-1 text-[11px] text-fg-subtle" title="Checklist">
            <CheckSquare className="size-3.5" /> {task.checklistDone}/{task.checklistTotal}
          </span>
        ) : null}
        {task.subtasksTotal ? (
          <span className="tabular inline-flex items-center gap-1 text-[11px] text-fg-subtle" title="Subtarefas">
            <ListTree className="size-3.5" /> {task.subtasksDone}/{task.subtasksTotal}
          </span>
        ) : null}
        <span className="flex-1" />
        {task.assigneeName ? <Avatar name={task.assigneeName} src={task.assigneeImage} size="xs" /> : null}
      </div>
    </article>
  );
}
