import { ListChecks } from "lucide-react";
import { Pagination } from "@/components/app/pagination";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Timeline } from "@/components/app/timeline";
import { todayISO } from "@/lib/format";
import type { TaskListRow } from "@/server/services/tasks";
import type { StatusRow } from "@/server/services/workflow";
import { TaskCalendar, type CalendarMode } from "./task-calendar";
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

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Intervalo do calendário: ?cal=day|week com ?date=AAAA-MM-DD, ou mês (?month=AAAA-MM). */
export function calendarRange(searchParams: Record<string, string | string[] | undefined>): {
  mode: CalendarMode;
  anchor: string;
  from: string;
  to: string;
} {
  const cal = searchParams.cal;
  if (cal === "day" || cal === "week") {
    const raw = searchParams.date;
    const date = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayISO();
    if (cal === "day") return { mode: "day", anchor: date, from: date, to: date };
    const start = plusDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
    return { mode: "week", anchor: start, from: start, to: plusDays(start, 6) };
  }
  const { from, to } = monthRange(searchParams);
  return { mode: "month", anchor: from, from, to };
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
  unscheduled = [],
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
  /** Tarefas sem prazo (bandeja do calendário). */
  unscheduled?: TaskListRow[];
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
    const range = calendarRange(searchParams);
    return <TaskCalendar {...range} rows={rows} unscheduled={unscheduled} base={base} canWrite={canWrite} />;
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
