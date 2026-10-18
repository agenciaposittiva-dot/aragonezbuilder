import { LayoutTemplate, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { SavedViewsMenu } from "@/components/tasks/saved-views";
import { TaskAiAssistant } from "@/components/tasks/task-ai";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { LabelManager } from "@/components/tasks/task-labels";
import { TaskListTable, type TaskGroupBy } from "@/components/tasks/task-list-table";
import { ApplyTemplateDialog } from "@/components/tasks/task-templates";
import { MineToggle, TasksViewSwitcher } from "@/components/tasks/tasks-toolbar";
import { calendarRange, TasksView } from "@/components/tasks/tasks-view";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { taskListParams } from "@/lib/validators/tasks";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listInternalMembers } from "@/server/services/members";
import { projectOptions } from "@/server/services/projects";
import { listLabels, listSavedViews } from "@/server/services/task-labels";
import { listTemplates } from "@/server/services/task-templates";
import { listTasks, taskIndicators, type TaskListRow } from "@/server/services/tasks";
import { listStatuses, listTransitions } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Tarefas" };

const GROUPS: { value: TaskGroupBy; label: string }[] = [
  { value: "status", label: "Agrupar por status" },
  { value: "project", label: "Agrupar por projeto" },
  { value: "client", label: "Agrupar por cliente" },
  { value: "assignee", label: "Agrupar por responsável" },
  { value: "priority", label: "Agrupar por prioridade" },
  { value: "due", label: "Agrupar por prazo" },
];
const SORTS = [
  { value: "due", label: "Ordenar por prazo" },
  { value: "priority", label: "Ordenar por prioridade" },
  { value: "recent", label: "Atualizadas recentemente" },
  { value: "title", label: "Ordenar por título" },
];

function minusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function TasksPage({ params, searchParams }: PageProps<"/w/[org]/tasks">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const raw = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string"));
  // A central abre na "Minha visão"; projetos continuam abrindo na lista/quadro.
  const parsed = taskListParams.safeParse({ view: "my", ...raw });
  const filters = parsed.success ? parsed.data : taskListParams.parse({ view: "my" });
  const view = filters.view;
  const groupBy = (GROUPS.find((g) => g.value === sp.group)?.value ?? "none") as TaskGroupBy;
  const today = todayISO();

  const data = await inOrg(actor, async (s) => {
    const base = {
      indicators: await taskIndicators(s),
      statuses: await listStatuses(s, "task"),
      transitions: await listTransitions(s),
      projects: await projectOptions(s),
      clients: await clientOptions(s),
      members: await listInternalMembers(s),
      labels: await listLabels(s),
      views: await listSavedViews(s),
      templates: await listTemplates(s),
    };
    if (view === "my") {
      const mine = { assignee: "me" as const, view: "list" as const, pageSize: 30 };
      return {
        ...base,
        my: {
          overdue: (await listTasks(s, { ...mine, due: "overdue", sort: "due" })).rows,
          today: (await listTasks(s, { ...mine, due: "today", sort: "priority" })).rows,
          week: (await listTasks(s, { ...mine, due: "week", sort: "due" })).rows.filter((r) => r.dueDate !== today),
          done: (await listTasks(s, { ...mine, completedSince: minusDays(today, 6), sort: "recent" })).rows,
        },
        list: null,
        focus: null,
      };
    }
    if (view === "focus") {
      const rows = (await listTasks(s, { assignee: "me", open: true, view: "list", sort: "focus", pageSize: 60 })).rows;
      return { ...base, my: null, list: null, focus: rows };
    }
    if (view === "calendar") {
      const { from, to } = calendarRange(sp);
      return {
        ...base,
        my: null,
        focus: null,
        list: await listTasks(s, { ...filters, from, to }),
        // Bandeja "sem prazo" para planejar arrastando para o calendário.
        unscheduled: can(actor, "tasks.write")
          ? (await listTasks(s, { ...filters, due: "none", from: undefined, to: undefined })).rows
          : [],
      };
    }
    return { ...base, my: null, focus: null, list: await listTasks(s, filters) };
  });

  const basePath = `/w/${actor.orgSlug}/tasks`;
  const wsBase = `/w/${actor.orgSlug}`;
  const canWrite = can(actor, "tasks.write");
  const canAssign = can(actor, "tasks.assign");
  const memberLite = data.members.map((m) => ({
    membershipId: m.membershipId,
    name: m.name,
    image: m.image,
    jobTitle: m.jobTitle,
    roleName: m.roleName,
  }));
  const statusOpts = data.statuses.map((st) => ({ id: st.id, name: st.name, color: st.color }));
  const projectOpts = data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
  const newButton = canWrite ? (
    <TaskFormDialog
      projects={projectOpts}
      members={memberLite}
      defaultProjectId={filters.projectId}
      trigger={
        <Button variant="primary">
          <Plus /> Nova tarefa
        </Button>
      }
    />
  ) : null;
  const table = (rows: TaskListRow[]) => (
    <TaskListTable
      rows={rows}
      statuses={statusOpts}
      transitions={data.transitions}
      members={memberLite}
      base={wsBase}
      canWrite={canWrite}
      canAssign={canAssign}
    />
  );
  const ind = data.indicators;
  const indicator = (label: string, value: number, href: string, tone?: "danger" | "warning") => (
    <Link
      href={href}
      className="rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2"
    >
      <p className="text-xs text-fg-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 text-lg font-semibold",
          tone === "danger" && value ? "text-danger" : tone === "warning" && value ? "text-warning" : "text-fg",
        )}
      >
        {value}
      </p>
    </Link>
  );
  const listLike = view === "list" || view === "board" || view === "calendar" || view === "timeline";

  return (
    <>
      <PageHeader
        title="Tarefas"
        description="Produção da equipe: responsáveis, prazos, prioridades e bloqueios."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TaskAiAssistant
              projects={projectOpts}
              members={memberLite}
              basePath={basePath}
              defaultProjectId={filters.projectId ?? null}
              initialRequestId={
                sp.assistente === "solicitacao" && typeof sp.solicitacao === "string" ? sp.solicitacao : null
              }
              canWrite={canWrite}
              canAssign={canAssign}
            />
            <Button variant="secondary" asChild>
              <Link href={`/w/${actor.orgSlug}/task-templates`}>
                <LayoutTemplate /> Modelos
              </Link>
            </Button>
            {canWrite && data.templates.length ? (
              <ApplyTemplateDialog
                templates={data.templates.map((t) => ({ id: t.id, name: t.name, steps: t.steps }))}
                projects={projectOpts}
                members={memberLite}
                defaultProjectId={filters.projectId}
                trigger={<Button variant="secondary">Usar modelo</Button>}
              />
            ) : null}
            {newButton}
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {indicator("Minhas abertas", ind.mine, `${basePath}?view=list&assignee=me&open=1`)}
          {indicator("Vencidas", ind.overdue, `${basePath}?view=list&due=overdue`, "danger")}
          {indicator("Para hoje", ind.today, `${basePath}?view=list&due=today`, "warning")}
          {indicator("Bloqueadas", ind.blocked, `${basePath}?view=list&blocked=1`, "warning")}
          {indicator("Sem responsável", ind.unassigned, `${basePath}?view=list&assignee=none&open=1`)}
          {indicator("Concluídas em 7 dias", ind.doneWeek, `${basePath}?view=my`)}
        </div>
        <TasksViewSwitcher basePath={basePath} searchParams={sp} defaultView="my" full />
        {listLike ? (
          <div className="flex flex-wrap items-center gap-2">
            <MineToggle basePath={basePath} searchParams={sp} />
            <FilterBar>
              <SearchFilter placeholder="Buscar tarefa" />
              <SelectFilter
                param="projectId"
                label="Projeto"
                options={projectOpts.map((p) => ({ value: p.id, label: `${p.clientName} · ${p.name}` }))}
              />
              <SelectFilter
                param="clientId"
                label="Cliente"
                options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
              />
              {filters.assignee === "me" ? null : (
                <SelectFilter
                  param="assignee"
                  label="Responsável"
                  options={[
                    { value: "none", label: "Sem responsável" },
                    ...data.members.map((m) => ({ value: m.membershipId, label: m.name })),
                  ]}
                />
              )}
              {view === "board" ? null : (
                <SelectFilter
                  param="statusId"
                  label="Status"
                  options={statusOpts.map((st) => ({ value: st.id, label: st.name }))}
                />
              )}
              <SelectFilter param="priority" label="Prioridade" options={PRIORITY_OPTIONS} />
              <SelectFilter
                param="due"
                label="Prazo"
                options={[
                  { value: "overdue", label: "Vencidas" },
                  { value: "today", label: "Para hoje" },
                  { value: "week", label: "Próximos 7 dias" },
                  { value: "none", label: "Sem prazo" },
                ]}
              />
              <SelectFilter param="blocked" label="Bloqueio" options={[{ value: "1", label: "Só bloqueadas" }]} />
              {data.labels.length ? (
                <SelectFilter
                  param="label"
                  label="Etiqueta"
                  options={data.labels.map((l) => ({ value: l.id, label: l.name }))}
                />
              ) : null}
              {view === "list" ? (
                <>
                  <SelectFilter param="group" label="Sem agrupamento" options={GROUPS} />
                  <SelectFilter param="sort" label="Ordem padrão" options={SORTS} />
                  <DateFilter param="from" label="Prazo de" />
                  <DateFilter param="to" label="até" />
                </>
              ) : null}
              <ClearFilters
                keys={[
                  "q",
                  "projectId",
                  "clientId",
                  "statusId",
                  "priority",
                  "from",
                  "to",
                  "due",
                  "blocked",
                  "group",
                  "sort",
                  "open",
                  "label",
                ]}
              />
            </FilterBar>
            <SavedViewsMenu basePath={basePath} views={data.views} />
            <LabelManager labels={data.labels} canManage={can(actor, "org.manage")} />
          </div>
        ) : null}
      </PageHeader>

      {data.my ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {(
            [
              ["Vencidas", data.my.overdue, "Nada vencido. Bom trabalho."],
              ["Para hoje", data.my.today, "Nenhuma entrega sua para hoje."],
              ["Próximos 7 dias", data.my.week, "Sem prazos nos próximos dias."],
              ["Concluídas recentemente", data.my.done, "Tarefas que você concluir aparecem aqui."],
            ] as const
          ).map(([title, rows, empty]) => (
            <Card key={title} className="min-w-0">
              <CardHeader>
                <CardTitle>
                  {title} <span className="ml-1 font-normal text-fg-subtle">{rows.length}</span>
                </CardTitle>
              </CardHeader>
              {rows.length ? table(rows) : <p className="px-5 pb-5 text-sm text-fg-muted">{empty}</p>}
            </Card>
          ))}
        </div>
      ) : data.focus ? (
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Fazer agora</CardTitle>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Suas tarefas abertas, por atraso, prioridade e prazo. Bloqueadas ficam abaixo.
                </p>
              </div>
            </CardHeader>
            {data.focus.filter((r) => !r.blocked).length ? (
              table(data.focus.filter((r) => !r.blocked))
            ) : (
              <p className="px-5 pb-5 text-sm text-fg-muted">Nenhuma tarefa aberta atribuída a você.</p>
            )}
          </Card>
          {data.focus.some((r) => r.blocked) ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Bloqueadas</CardTitle>
                  <p className="mt-0.5 text-xs text-fg-muted">Dependem de outras tarefas ainda abertas.</p>
                </div>
              </CardHeader>
              {table(data.focus.filter((r) => r.blocked))}
            </Card>
          ) : null}
        </div>
      ) : data.list ? (
        <TasksView
          view={view}
          rows={data.list.rows}
          total={data.list.total}
          page={data.list.page}
          pageSize={data.list.pageSize}
          statuses={data.statuses}
          orgSlug={actor.orgSlug}
          basePath={basePath}
          searchParams={sp}
          canWrite={canWrite}
          projects={projectOpts}
          assigneeMembershipId={filters.assignee === "me" ? actor.membershipId : undefined}
          emptyAction={newButton}
          transitions={data.transitions}
          members={memberLite}
          canAssign={canAssign}
          groupBy={groupBy}
          unscheduled={"unscheduled" in data ? data.unscheduled : []}
        />
      ) : null}
    </>
  );
}
