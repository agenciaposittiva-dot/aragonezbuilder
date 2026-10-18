import { Plus } from "lucide-react";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { MineToggle, TasksViewSwitcher } from "@/components/tasks/tasks-toolbar";
import { monthRange, TasksView } from "@/components/tasks/tasks-view";
import { Button } from "@/components/ui/button";
import { taskListParams } from "@/lib/validators/tasks";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listInternalMembers } from "@/server/services/members";
import { getProject } from "@/server/services/projects";
import { listTasks } from "@/server/services/tasks";
import { listStatuses, listTransitions } from "@/server/services/workflow";

export default async function ProjectTasksPage({ params, searchParams }: PageProps<"/w/[org]/projects/[id]/tasks">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const raw = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string"));
  const parsed = taskListParams.safeParse({ view: "board", ...raw, projectId: id });
  const filters = parsed.success ? parsed.data : taskListParams.parse({ projectId: id, view: "board" });
  const query = filters.view === "calendar" ? { ...filters, ...monthRange(sp) } : filters;

  const data = await inOrg(actor, async (s) => ({
    project: await getProject(s, id),
    list: await listTasks(s, query),
    statuses: await listStatuses(s, "task"),
    transitions: await listTransitions(s),
    members: await listInternalMembers(s),
  }));
  const basePath = `/w/${actor.orgSlug}/projects/${id}/tasks`;
  const canWrite = can(actor, "tasks.write");
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
            <ClearFilters keys={["q", "priority"]} />
          </FilterBar>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TasksViewSwitcher basePath={basePath} searchParams={sp} defaultView="board" />
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
      />
    </div>
  );
}
