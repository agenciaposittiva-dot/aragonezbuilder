"use client";

import { AlertTriangle, CheckSquare, ChevronDown, GitBranch, Lock, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DueDate } from "@/components/app/due-date";
import { MemberPicker } from "@/components/app/member-picker";
import { PRIORITY_OPTIONS, PriorityLabel } from "@/components/app/priority";
import { StatusSelect, type StatusOption } from "@/components/projects/status-select";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate, PRIORITY_LABEL, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changeTaskStatusAction, updateTaskAction } from "@/server/actions/tasks";
import type { TaskListRow } from "@/server/services/tasks";
import { TaskDoneCheckbox } from "./task-done-checkbox";
import { LabelList } from "./task-labels";

export type TaskGroupBy = "none" | "status" | "project" | "client" | "assignee" | "priority" | "due";
type Member = { membershipId: string; name: string; image: string | null };
type Transition = { fromStatusId: string; toStatusId: string };
type Priority = TaskListRow["priority"];

const PRIORITY_ORDER: Priority[] = ["urgent", "high", "medium", "low"];

function dueBucket(row: TaskListRow, today: string) {
  if (row.completedAt) return { key: "5", label: "Concluídas" };
  if (!row.dueDate) return { key: "4", label: "Sem prazo" };
  if (row.dueDate < today) return { key: "0", label: "Vencidas" };
  if (row.dueDate === today) return { key: "1", label: "Hoje" };
  const days = (new Date(`${row.dueDate}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000;
  return days <= 7 ? { key: "2", label: "Próximos 7 dias" } : { key: "3", label: "Mais adiante" };
}

/**
 * Lista de tarefas com edição direta (status pelo fluxo, prioridade,
 * responsável e prazo), agrupamento e sinais de atraso/bloqueio. As mudanças
 * aparecem na hora e são desfeitas se o servidor recusar.
 */
export function TaskListTable({
  rows,
  statuses,
  transitions,
  members,
  base,
  canWrite,
  canAssign,
  groupBy = "none",
  hideProject,
}: {
  rows: TaskListRow[];
  statuses: StatusOption[];
  transitions: Transition[];
  members: Member[];
  base: string;
  canWrite: boolean;
  canAssign: boolean;
  groupBy?: TaskGroupBy;
  hideProject?: boolean;
}) {
  const [overrides, setOverrides] = useState<Record<string, Partial<TaskListRow>>>({});
  const status = useOrgAction(changeTaskStatusAction);
  const update = useOrgAction(updateTaskAction);
  const today = todayISO();
  const view = useMemo(() => rows.map((r) => ({ ...r, ...overrides[r.id] })), [rows, overrides]);

  async function patch(id: string, local: Partial<TaskListRow>, send: () => Promise<{ ok: boolean }>) {
    const before = overrides[id];
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...local } }));
    const res = await send();
    if (!res.ok) setOverrides((o) => ({ ...o, [id]: before ?? {} }));
  }

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: "", rows: view }];
    const map = new Map<string, { key: string; label: string; order: string; rows: TaskListRow[] }>();
    for (const r of view) {
      const g =
        groupBy === "status"
          ? {
              key: r.statusId,
              label: r.statusName,
              order: String(statuses.findIndex((s) => s.id === r.statusId)).padStart(3, "0"),
            }
          : groupBy === "project"
            ? {
                key: r.projectId,
                label: `${r.clientName} · ${r.projectName}`,
                order: `${r.clientName} ${r.projectName}`,
              }
            : groupBy === "client"
              ? { key: r.clientId, label: r.clientName, order: r.clientName }
              : groupBy === "assignee"
                ? {
                    key: r.assigneeMembershipId ?? "none",
                    label: r.assigneeName ?? "Sem responsável",
                    order: r.assigneeName ?? "~",
                  }
                : groupBy === "priority"
                  ? {
                      key: r.priority,
                      label: PRIORITY_LABEL[r.priority]!,
                      order: String(PRIORITY_ORDER.indexOf(r.priority)),
                    }
                  : (() => {
                      const b = dueBucket(r, today);
                      return { key: b.key, label: b.label, order: b.key };
                    })();
      const entry = map.get(g.key) ?? { ...g, rows: [] };
      entry.rows.push(r);
      map.set(g.key, entry);
    }
    return [...map.values()].sort((a, b) => a.order.localeCompare(b.order, "pt-BR"));
  }, [view, groupBy, statuses, today]);

  return (
    <Table>
      <THead>
        <tr>
          <TH className="w-10" aria-label="Concluída" />
          <TH>Tarefa</TH>
          <TH>Status</TH>
          <TH className="hidden md:table-cell">Responsável</TH>
          <TH className="hidden lg:table-cell">Prioridade</TH>
          <TH>Prazo</TH>
        </tr>
      </THead>
      <TBody>
        {groups.map((g) => (
          <GroupRows key={g.key} label={g.label} count={g.rows.length} grouped={groupBy !== "none"}>
            {g.rows.map((t) => {
              const overdue = !t.completedAt && !!t.dueDate && t.dueDate < today;
              const allowed = transitions.filter((x) => x.fromStatusId === t.statusId).map((x) => x.toStatusId);
              const current = { id: t.statusId, name: t.statusName, color: t.statusColor };
              return (
                <TR key={t.id} className={cn(overdue && "bg-danger-soft/40")}>
                  <TD className="w-10 pr-0">
                    <TaskDoneCheckbox taskId={t.id} done={!!t.completedAt} disabled={!canWrite} label={t.title} />
                  </TD>
                  <TD className="max-w-[380px]">
                    <Link href={`${base}/tasks/${t.id}`} className="group block">
                      <span
                        className={cn(
                          "block truncate font-medium group-hover:underline",
                          t.completedAt && "text-fg-subtle line-through",
                        )}
                      >
                        {t.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                        {hideProject ? null : (
                          <span className="truncate">
                            {t.clientName} · {t.projectName}
                          </span>
                        )}
                        {t.subtasksTotal ? (
                          <span className="inline-flex items-center gap-1">
                            <GitBranch className="size-3" /> {t.subtasksDone}/{t.subtasksTotal}
                          </span>
                        ) : null}
                        {t.checklistTotal ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckSquare className="size-3" /> {t.checklistDone}/{t.checklistTotal}
                          </span>
                        ) : null}
                        {t.blocked && !t.completedAt ? (
                          <Badge tone="warning" className="gap-1">
                            <Lock className="size-3" /> Bloqueada
                          </Badge>
                        ) : null}
                        {t.labels?.length ? <LabelList labels={t.labels} /> : null}
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    <StatusSelect
                      current={current}
                      statuses={statuses}
                      allowedIds={allowed.length ? allowed : null}
                      disabled={!canWrite}
                      onChange={(statusId) => {
                        const s = statuses.find((x) => x.id === statusId);
                        if (!s) return;
                        void patch(t.id, { statusId, statusName: s.name, statusColor: s.color }, () =>
                          status.run({ taskId: t.id, statusId }),
                        );
                      }}
                    />
                  </TD>
                  <TD className="hidden md:table-cell">
                    {canAssign ? (
                      <MemberPicker
                        single
                        members={members}
                        value={t.assigneeMembershipId ? [t.assigneeMembershipId] : []}
                        onChange={(ids) => {
                          const id = ids[0] ?? null;
                          const m = members.find((x) => x.membershipId === id);
                          void patch(
                            t.id,
                            {
                              assigneeMembershipId: id,
                              assigneeName: m?.name ?? null,
                              assigneeImage: m?.image ?? null,
                            },
                            () => update.run({ id: t.id, assigneeMembershipId: id }),
                          );
                        }}
                        trigger={
                          <button
                            type="button"
                            className="flex max-w-[180px] items-center gap-2 rounded-md px-1.5 py-1 text-left text-fg-muted hover:bg-surface-2"
                          >
                            {t.assigneeName ? (
                              <>
                                <Avatar name={t.assigneeName} src={t.assigneeImage} size="xs" />
                                <span className="truncate">{t.assigneeName}</span>
                              </>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-fg-subtle">
                                <UserRound className="size-3.5" /> Sem responsável
                              </span>
                            )}
                          </button>
                        }
                      />
                    ) : t.assigneeName ? (
                      <span className="flex items-center gap-2 text-fg-muted">
                        <Avatar name={t.assigneeName} src={t.assigneeImage} size="xs" />
                        <span className="truncate">{t.assigneeName}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-fg-subtle">Sem responsável</span>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell">
                    {canWrite ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-surface-2">
                          <PriorityLabel priority={t.priority} />
                          <ChevronDown className="size-3 text-fg-subtle" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {PRIORITY_OPTIONS.map((o) => (
                            <DropdownMenuItem
                              key={o.value}
                              onSelect={() =>
                                void patch(t.id, { priority: o.value }, () =>
                                  update.run({ id: t.id, priority: o.value }),
                                )
                              }
                            >
                              <PriorityLabel priority={o.value} />
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <PriorityLabel priority={t.priority} />
                    )}
                  </TD>
                  <TD>
                    {canWrite ? (
                      <label className="relative inline-flex cursor-pointer items-center" title="Alterar prazo">
                        <DueDate date={t.dueDate} done={!!t.completedAt} />
                        {overdue ? <AlertTriangle className="ml-1 size-3.5 text-danger" aria-label="Vencida" /> : null}
                        <input
                          type="date"
                          aria-label={`Prazo de ${t.title}`}
                          value={t.dueDate ?? ""}
                          onChange={(e) => {
                            const dueDate = e.target.value || null;
                            void patch(t.id, { dueDate }, () => update.run({ id: t.id, dueDate }));
                          }}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                      </label>
                    ) : (
                      <span title={t.dueDate ? formatDate(t.dueDate) : undefined}>
                        <DueDate date={t.dueDate} done={!!t.completedAt} />
                      </span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </GroupRows>
        ))}
      </TBody>
    </Table>
  );
}

function GroupRows({
  label,
  count,
  grouped,
  children,
}: {
  label: string;
  count: number;
  grouped: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (!grouped) return <>{children}</>;
  return (
    <>
      <tr className="bg-surface-2/60">
        <td colSpan={6} className="px-3 py-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted hover:text-fg"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
            {label}
            <span className="font-normal text-fg-subtle">{count}</span>
          </button>
        </td>
      </tr>
      {open ? children : null}
    </>
  );
}
