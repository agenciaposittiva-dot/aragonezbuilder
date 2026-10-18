import { LayoutTemplate, Plus } from "lucide-react";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { ApplyTemplateDialog } from "@/components/tasks/task-templates";
import { MineToggle, TasksViewSwitcher } from "@/components/tasks/tasks-toolbar";
import { calendarRange, TasksView } from "@/components/tasks/tasks-view";
import { Button } from "@/components/ui/button";
import { taskListParams } from "@/lib/validators/tasks";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listInternalMembers } from "@/server/services/members";
import { getProject } from "@/server/services/projects";
import { listLabels } from "@/server/services/task-labels";
import { listTemplates } from "@/server/services/task-templates";
import { listTasks } from "@/server/services/tasks";
import { listStatuses, listTransitions } from "@/server/services/workflow";

export default async function ProjectTasksPage({ params, searchParams }: PageProps<"/w/[org]/projects/[id]/tasks">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const raw = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string"));
  const parsed = taskListParams.safeParse({ view: "board", ...raw, projectId: id });
  const filters = parsed.success ? parsed.data : taskListParams.parse({ projectId: id, view: "board" });
  const calendar = filters.view === "calendar";
  const query = calendar ? { ...filters, ...calendarRange(sp) } : filters;
  const canWrite = can(actor, "tasks.write");

  const data = await inOrg(actor, async (s) => ({
    project: await getProject(s, id),
    list: await listTasks(s, query),
    unscheduled: calendar && canWrite ? (await listTasks(s, { ...filters, due: "none" })).rows : [],
    statuses: await listStatuses(s, "task"),
    transitions: await listTransitions(s),
    members: await listInternalMembers(s),
    labels: await listLabels(s),
    templates: await listTemplates(s),
  }));
  const basePath = `/w/${actor.orgSlug}/projects/${id}/tasks`;
  const projectOpts = [{ id, name: data.project.project.name, clientName: data.project.clientName }];

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <MineToggle basePath={basePath} searchParams={sp} />
          <FilterBar>
            <SearchFilter placeholder="Buscar tarefa" />
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
            <SelectFilter param="priority" label="Prioridade" options={PRIORITY_OPTIONS} />
            {data.labels.length ? (
              <SelectFilter
                param="label"
                label="Etiqueta"
                options={data.labels.map((l) => ({ value: l.id, label: l.name }))}
              />
            ) : null}
            <ClearFilters keys={["q", "priority", "label"]} />
          </FilterBar>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TasksViewSwitcher basePath={basePath} searchParams={sp} defaultView="board" />
          {canWrite && data.templates.length ? (
            <ApplyTemplateDialog
              templates={data.templates.map((t) => ({ id: t.id, name: t.name, steps: t.steps }))}
              projects={projectOpts}
              members={data.members.map((m) => ({ membershipId: m.membershipId, name: m.name, image: m.image }))}
              defaultProjectId={id}
              trigger={
                <Button variant="secondary">
                  <LayoutTemplate /> Usar modelo
                </Button>
              }
            />
          ) : null}
          {canWrite ? (
            <TaskFormDialog
              projects={projectOpts}
              defaultProjectId={id}
              members={data.members.map((m) => ({
                membershipId: m.membershipId,
                name: m.name,
                image: m.image,
                jobTitle: m.jobTitle,
              }))}
              trigger={
                <Button variant="primary">
                  <Plus /> Nova tarefa
                </Button>
              }
            />
          ) : null}
        </div>
      </div>
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
        projectId={id}
        assigneeMembershipId={filters.assignee === "me" ? actor.membershipId : undefined}
        transitions={data.transitions}
        members={data.members.map((m) => ({ membershipId: m.membershipId, name: m.name, image: m.image }))}
        canAssign={can(actor, "tasks.assign")}
        unscheduled={data.unscheduled}
      />
    </div>
  );
}
