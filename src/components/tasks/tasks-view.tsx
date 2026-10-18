import { ListChecks } from "lucide-react";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { MonthCalendar } from "@/components/app/month-calendar";
import { Pagination } from "@/components/app/pagination";
import { PriorityLabel } from "@/components/app/priority";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { todayISO } from "@/lib/format";
import type { TaskListRow } from "@/server/services/tasks";
import type { StatusRow } from "@/server/services/workflow";
import { TaskDoneCheckbox } from "./task-done-checkbox";
import { TasksBoard } from "./tasks-board";
import type { ProjectOption } from "./task-form-dialog";

type View = "list" | "board" | "calendar";

export function monthRange(searchParams: Record<string, string | string[] | undefined>) {
  const month =
    typeof searchParams.month === "string" && /^\d{4}-\d{2}$/.test(searchParams.month)
      ? searchParams.month
      : todayISO().slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function TasksView({
  view,
  rows,
  total,
  page,
  pageSize,
  statuses,
  orgSlug,
  basePath,
  searchParams,
  canWrite,
  projectId,
  projects,
  assigneeMembershipId,
  emptyAction,
}: {
  view: View;
  rows: TaskListRow[];
  total: number;
  page: number;
  pageSize: number;
  statuses: StatusRow[];
  orgSlug: string;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  canWrite: boolean;
  projectId?: string;
  projects?: ProjectOption[];
  assigneeMembershipId?: string;
  emptyAction?: React.ReactNode;
}) {
  const base = `/w/${orgSlug}`;
  if (view === "board") {
    return (
      <TasksBoard
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
        rows={rows}
        canWrite={canWrite}
        projectId={projectId}
        projects={projects}
        assigneeMembershipId={assigneeMembershipId}
      />
    );
  }
  if (view === "calendar") {
    const { month } = monthRange(searchParams);
    return (
      <MonthCalendar
        month={month}
        events={rows
          .filter((r) => r.dueDate)
          .map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: `${r.clientName} · ${r.projectName}`,
            date: r.dueDate!,
            color: r.statusColor,
            href: `${base}/tasks/${r.id}`,
            done: !!r.completedAt,
          }))}
        hrefForMonth={(mth) => {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "month") qs.set(k, v);
          qs.set("month", mth);
          return `${basePath}?${qs.toString()}`;
        }}
      />
    );
  }

  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma tarefa encontrada"
          description="Crie uma tarefa ou ajuste os filtros."
          action={emptyAction}
        />
      ) : (
        <>
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
              {rows.map((t) => (
                <TR key={t.id} className="relative">
                  <TD className="w-10 pr-0">
                    <TaskDoneCheckbox taskId={t.id} done={!!t.completedAt} disabled={!canWrite} label={t.title} />
                  </TD>
                  <TD className="max-w-[360px]">
                    <Link href={`${base}/tasks/${t.id}`} className="block after:absolute after:inset-0">
                      <span
                        className={`block truncate font-medium ${t.completedAt ? "text-fg-subtle line-through" : ""}`}
                      >
                        {t.title}
                      </span>
                      {projectId ? null : (
                        <span className="block truncate text-xs text-fg-muted">
                          {t.clientName} · {t.projectName}
                        </span>
                      )}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge name={t.statusName} color={t.statusColor} />
                  </TD>
                  <TD className="hidden md:table-cell">
                    {t.assigneeName ? (
                      <span className="flex items-center gap-2 text-fg-muted">
                        <Avatar name={t.assigneeName} src={t.assigneeImage} size="xs" />
                        <span className="truncate">{t.assigneeName}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-fg-subtle">Sem responsável</span>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <PriorityLabel priority={t.priority} />
                  </TD>
                  <TD>
                    <DueDate date={t.dueDate} done={!!t.completedAt} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={searchParams} basePath={basePath} />
        </>
      )}
    </Card>
  );
}
