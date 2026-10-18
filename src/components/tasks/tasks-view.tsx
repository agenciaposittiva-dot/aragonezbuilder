import { ListChecks } from "lucide-react";
import { MonthCalendar } from "@/components/app/month-calendar";
import { Pagination } from "@/components/app/pagination";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Timeline } from "@/components/app/timeline";
import { todayISO } from "@/lib/format";
import type { TaskListRow } from "@/server/services/tasks";
import type { StatusRow } from "@/server/services/workflow";
import { TaskListTable, type TaskGroupBy } from "./task-list-table";
import { TasksBoard } from "./tasks-board";
import type { ProjectOption } from "./task-form-dialog";

type View = "my" | "list" | "board" | "calendar" | "timeline" | "focus";

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
  transitions = [],
  members = [],
  canAssign = false,
  groupBy = "none",
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
  transitions?: { fromStatusId: string; toStatusId: string }[];
  members?: { membershipId: string; name: string; image: string | null }[];
  canAssign?: boolean;
  groupBy?: TaskGroupBy;
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

  if (view === "timeline") {
    return (
      <Timeline
        rows={rows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: `${r.clientName} · ${r.projectName}${r.blocked && !r.completedAt ? " · bloqueada" : ""}${
            r.startDate && r.dueDate && r.startDate > r.dueDate ? " · conflito: prazo antes do início" : ""
          }`,
          start: r.startDate ?? r.dueDate,
          end: r.dueDate ?? r.startDate,
          color: r.statusColor,
          href: `${base}/tasks/${r.id}`,
          progress: r.subtasksTotal ? Math.round((r.subtasksDone / r.subtasksTotal) * 100) : r.completedAt ? 100 : 0,
        }))}
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
          <TaskListTable
            rows={rows}
            statuses={statuses.map((st) => ({ id: st.id, name: st.name, color: st.color }))}
            transitions={transitions}
            members={members}
            base={base}
            canWrite={canWrite}
            canAssign={canAssign}
            groupBy={groupBy}
            hideProject={!!projectId}
          />
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={searchParams} basePath={basePath} />
        </>
      )}
    </Card>
  );
}
