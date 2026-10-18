"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DueDate } from "@/components/app/due-date";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { createTaskAction } from "@/server/actions/tasks";
import { TaskDoneCheckbox } from "../task-done-checkbox";

type Subtask = {
  id: string;
  title: string;
  completedAt: Date | null;
  dueDate: string | null;
  statusName: string;
  statusColor: string;
  assigneeName: string | null;
  assigneeImage: string | null;
};

export function TaskSubtasks({
  taskId,
  projectId,
  subtasks,
  canWrite,
}: {
  taskId: string;
  projectId: string;
  subtasks: Subtask[];
  canWrite: boolean;
}) {
  const { orgSlug } = useWorkspace();
  const [title, setTitle] = useState("");
  const create = useOrgAction(createTaskAction, { onSuccess: () => setTitle("") });

  return (
    <div className="grid gap-3">
      {subtasks.length ? (
        <ul className="grid divide-y divide-border rounded-lg border border-border">
          {subtasks.map((st) => (
            <li key={st.id} className="flex items-center gap-3 px-3 py-2">
              <TaskDoneCheckbox taskId={st.id} done={!!st.completedAt} disabled={!canWrite} label={st.title} />
              <Link
                href={`/w/${orgSlug}/tasks/${st.id}`}
                className={cn(
                  "min-w-0 flex-1 truncate text-sm hover:underline",
                  st.completedAt && "text-fg-subtle line-through",
                )}
              >
                {st.title}
              </Link>
              <span className="hidden sm:inline-flex">
                <StatusBadge name={st.statusName} color={st.statusColor} />
              </span>
              <DueDate date={st.dueDate} done={!!st.completedAt} />
              {st.assigneeName ? <Avatar name={st.assigneeName} src={st.assigneeImage} size="xs" /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">Nenhuma subtarefa.</p>
      )}
      {canWrite ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.run({ projectId, parentTaskId: taskId, title: title.trim() });
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nova subtarefa"
            className="h-8"
            aria-label="Nova subtarefa"
          />
          <Button type="submit" size="sm" variant="secondary" loading={create.pending} disabled={!title.trim()}>
            <Plus /> Adicionar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
