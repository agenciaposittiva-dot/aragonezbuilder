import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ClearFilters, DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { MineToggle, TasksViewSwitcher } from "@/components/tasks/tasks-toolbar";
import { monthRange, TasksView } from "@/components/tasks/tasks-view";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { taskListParams } from "@/lib/validators/tasks";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listInternalMembers } from "@/server/services/members";
import { projectOptions } from "@/server/services/projects";
import { listTasks } from "@/server/services/tasks";
import { listStatuses } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Tarefas" };

export default async function TasksPage({ params, searchParams }: PageProps<"/w/[org]/tasks">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const raw = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string"));
  const parsed = taskListParams.safeParse(raw);
  const filters = parsed.success ? parsed.data : taskListParams.parse({});
  const query = filters.view === "calendar" ? { ...filters, ...monthRange(sp) } : filters;

  const data = await inOrg(actor, async (s) => ({
    list: await listTasks(s, query),
    statuses: await listStatuses(s, "task"),
    projects: await projectOptions(s),
    clients: await clientOptions(s),
    members: await listInternalMembers(s),
  }));
  const basePath = `/w/${actor.orgSlug}/tasks`;
  const canWrite = can(actor, "tasks.write");
  const memberLite = data.members.map((m) => ({
    membershipId: m.membershipId,
    name: m.name,
    image: m.image,
    jobTitle: m.jobTitle,
    roleName: m.roleName,
  }));
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

  return (
    <>
      <PageHeader
        title="Tarefas"
        description="Produção da equipe: responsáveis, prazos, status e esforço."
        actions={newButton}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
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
              {filters.view === "board" ? null : (
                <SelectFilter
                  param="statusId"
                  label="Status"
                  options={data.statuses.map((st) => ({ value: st.id, label: st.name }))}
                />
              )}
              <SelectFilter param="priority" label="Prioridade" options={PRIORITY_OPTIONS} />
              {filters.view === "list" ? (
                <>
                  <DateFilter param="from" label="Prazo de" />
                  <DateFilter param="to" label="até" />
                </>
              ) : null}
              <ClearFilters keys={["q", "projectId", "clientId", "statusId", "priority", "from", "to"]} />
            </FilterBar>
          </div>
          <TasksViewSwitcher basePath={basePath} searchParams={sp} />
        </div>
      </PageHeader>
      <TasksView
        view={filters.view}
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
      />
    </>
  );
}
