import { CalendarDays, FolderKanban, GanttChart, KanbanSquare, List } from "lucide-react";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { MonthCalendar } from "@/components/app/month-calendar";
import { Pagination } from "@/components/app/pagination";
import { PriorityLabel } from "@/components/app/priority";
import { Timeline } from "@/components/app/timeline";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { todayISO } from "@/lib/format";
import type { ProjectListRow } from "@/server/services/projects";
import type { StatusRow } from "@/server/services/workflow";
import { ProjectsBoard } from "./projects-board";

type View = "list" | "board" | "calendar" | "timeline";

export function ViewSwitcher({
  basePath,
  searchParams,
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const make = (view: View) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams))
      if (typeof v === "string" && k !== "view" && k !== "page") qs.set(k, v);
    if (view !== "list") qs.set("view", view);
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <SegmentedNav
      param="view"
      items={[
        { label: "Lista", href: make("list"), value: "list", icon: <List /> },
        { label: "Quadro", href: make("board"), value: "board", icon: <KanbanSquare /> },
        { label: "Calendário", href: make("calendar"), value: "calendar", icon: <CalendarDays /> },
        { label: "Linha do tempo", href: make("timeline"), value: "timeline", icon: <GanttChart /> },
      ]}
    />
  );
}

export function ProjectsView({
  view,
  rows,
  total,
  page,
  pageSize,
  statuses,
  orgSlug,
  basePath,
  searchParams,
  canMove,
  emptyAction,
  hideClient,
}: {
  view: View;
  rows: ProjectListRow[];
  total: number;
  page: number;
  pageSize: number;
  statuses: StatusRow[];
  orgSlug: string;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  canMove: boolean;
  emptyAction?: React.ReactNode;
  hideClient?: boolean;
}) {
  const base = `/w/${orgSlug}`;
  if (view === "board") {
    return (
      <ProjectsBoard
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
        rows={rows}
        canMove={canMove}
      />
    );
  }
  if (view === "calendar") {
    const month =
      typeof searchParams.month === "string" && /^\d{4}-\d{2}$/.test(searchParams.month)
        ? searchParams.month
        : todayISO().slice(0, 7);
    return (
      <MonthCalendar
        month={month}
        events={rows
          .filter((r) => r.dueDate)
          .map((r) => ({
            id: r.id,
            title: r.name,
            subtitle: r.clientName,
            date: r.dueDate!,
            color: r.statusColor,
            href: `${base}/projects/${r.id}`,
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
          title: r.name,
          subtitle: r.clientName,
          start: r.startDate,
          end: r.dueDate,
          color: r.statusColor,
          href: `${base}/projects/${r.id}`,
          progress: r.tasksTotal ? r.tasksDone / r.tasksTotal : undefined,
        }))}
      />
    );
  }

  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Nenhum projeto encontrado"
          description="Crie um projeto ou ajuste os filtros."
          action={emptyAction}
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Projeto</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Responsável</TH>
                <TH className="hidden lg:table-cell">Prioridade</TH>
                <TH className="hidden sm:table-cell">Progresso</TH>
                <TH>Prazo</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((p) => (
                <TR key={p.id} className="relative">
                  <TD className="max-w-[320px]">
                    <Link href={`${base}/projects/${p.id}`} className="block after:absolute after:inset-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      {hideClient ? null : <span className="block truncate text-xs text-fg-muted">{p.clientName}</span>}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge name={p.statusName} color={p.statusColor} />
                  </TD>
                  <TD className="hidden md:table-cell">
                    {p.ownerName ? (
                      <span className="flex items-center gap-2 text-fg-muted">
                        <Avatar name={p.ownerName} src={p.ownerImage} size="xs" />
                        <span className="truncate">{p.ownerName}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <PriorityLabel priority={p.priority} />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {p.tasksTotal ? (
                      <div className="flex w-28 items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${Math.round((p.tasksDone / p.tasksTotal) * 100)}%` }}
                          />
                        </div>
                        <span className="tabular text-[11px] text-fg-subtle">
                          {Math.round((p.tasksDone / p.tasksTotal) * 100)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-fg-subtle">Sem tarefas</span>
                    )}
                  </TD>
                  <TD>
                    <DueDate date={p.dueDate} done={!!p.completedAt} />
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
