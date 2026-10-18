"use client";

import { Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DueDate } from "@/components/app/due-date";
import { MemberPicker } from "@/components/app/member-picker";
import { StatusSelect, type StatusOption } from "@/components/projects/status-select";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { changeTaskStatusAction, createTaskAction, updateTaskAction } from "@/server/actions/tasks";
import { TaskDoneCheckbox } from "../task-done-checkbox";

type Subtask = {
  id: string;
  title: string;
  completedAt: Date | null;
  dueDate: string | null;
  statusId: string;
  statusName: string;
  statusColor: string;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
};
type Member = { membershipId: string; name: string; image: string | null };

/**
 * Subtarefas com edição direta de status (pelo fluxo), responsável e prazo.
 * A mudança aparece na hora e é desfeita se o servidor recusar.
 */
export function TaskSubtasks({
  taskId,
  projectId,
  subtasks,
  canWrite,
  canAssign = false,
  statuses = [],
  transitions = [],
  members = [],
}: {
  taskId: string;
  projectId: string;
  subtasks: Subtask[];
  canWrite: boolean;
  canAssign?: boolean;
  statuses?: StatusOption[];
  transitions?: { fromStatusId: string; toStatusId: string }[];
  members?: Member[];
}) {
  const { orgSlug } = useWorkspace();
  const [title, setTitle] = useState("");
  const [overrides, setOverrides] = useState<Record<string, Partial<Subtask>>>({});
  const create = useOrgAction(createTaskAction, { onSuccess: () => setTitle("") });
  const status = useOrgAction(changeTaskStatusAction);
  const update = useOrgAction(updateTaskAction);
  const rows = useMemo(() => subtasks.map((s) => ({ ...s, ...overrides[s.id] })), [subtasks, overrides]);

  async function patch(id: string, local: Partial<Subtask>, send: () => Promise<{ ok: boolean }>) {
    const before = overrides[id];
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...local } }));
    const res = await send();
    if (!res.ok) setOverrides((o) => ({ ...o, [id]: before ?? {} }));
  }

  return (
    <div className="grid gap-3">
      {rows.length ? (
        <ul className="grid divide-y divide-border rounded-lg border border-border">
          {rows.map((st) => {
            const allowed = transitions.filter((x) => x.fromStatusId === st.statusId).map((x) => x.toStatusId);
            return (
              <li key={st.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
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
                <div className="flex items-center gap-2">
                  <StatusSelect
                    current={{ id: st.statusId, name: st.statusName, color: st.statusColor }}
                    statuses={statuses}
                    allowedIds={allowed.length ? allowed : null}
                    disabled={!canWrite || !statuses.length}
                    onChange={(statusId) => {
                      const s = statuses.find((x) => x.id === statusId);
                      if (!s) return;
                      void patch(st.id, { statusId, statusName: s.name, statusColor: s.color }, () =>
                        status.run({ taskId: st.id, statusId }),
                      );
                    }}
                  />
                  {canWrite ? (
                    <label className="relative inline-flex cursor-pointer items-center" title="Alterar prazo">
                      <DueDate date={st.dueDate} done={!!st.completedAt} />
                      {st.dueDate ? null : <span className="text-xs text-fg-subtle">Prazo</span>}
                      <input
                        type="date"
                        aria-label={`Prazo de ${st.title}`}
                        value={st.dueDate ?? ""}
                        onChange={(e) => {
                          const dueDate = e.target.value || null;
                          void patch(st.id, { dueDate }, () => update.run({ id: st.id, dueDate }));
                        }}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </label>
                  ) : (
                    <DueDate date={st.dueDate} done={!!st.completedAt} />
                  )}
                  {canAssign ? (
                    <MemberPicker
                      single
                      members={members}
                      value={st.assigneeMembershipId ? [st.assigneeMembershipId] : []}
                      onChange={(ids) => {
                        const id = ids[0] ?? null;
                        const m = members.find((x) => x.membershipId === id);
                        void patch(
                          st.id,
                          { assigneeMembershipId: id, assigneeName: m?.name ?? null, assigneeImage: m?.image ?? null },
                          () => update.run({ id: st.id, assigneeMembershipId: id }),
                        );
                      }}
                      trigger={
                        <button
                          type="button"
                          aria-label={`Responsável por ${st.title}`}
                          className="rounded-full p-0.5 hover:bg-surface-2"
                        >
                          {st.assigneeName ? (
                            <Avatar name={st.assigneeName} src={st.assigneeImage} size="xs" />
                          ) : (
                            <UserRound className="size-4 text-fg-subtle" />
                          )}
                        </button>
                      }
                    />
                  ) : st.assigneeName ? (
                    <Avatar name={st.assigneeName} src={st.assigneeImage} size="xs" />
                  ) : null}
                </div>
              </li>
            );
          })}
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
