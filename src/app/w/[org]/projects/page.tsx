import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ClearFilters, DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectsView, ViewSwitcher } from "@/components/projects/projects-view";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { projectListParams } from "@/lib/validators/projects";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listInternalMembers } from "@/server/services/members";
import { listProjects } from "@/server/services/projects";
import { listStatuses } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjectsPage({ params, searchParams }: PageProps<"/w/[org]/projects">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "projects.read" });
  const parsed = projectListParams.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")),
  );
  const filters = parsed.success ? parsed.data : projectListParams.parse({});
  const { list, statuses, clients, members } = await inOrg(actor, async (s) => ({
    list: await listProjects(s, filters),
    statuses: await listStatuses(s, "project"),
    clients: await clientOptions(s),
    members: await listInternalMembers(s),
  }));
  const basePath = `/w/${actor.orgSlug}/projects`;
  const canWrite = can(actor, "projects.write");
  const memberLite = members.map((m) => ({
    membershipId: m.membershipId,
    name: m.name,
    image: m.image,
    jobTitle: m.jobTitle,
    roleName: m.roleName,
  }));
  const newButton = canWrite ? (
    <ProjectFormDialog
      clients={clients}
      members={memberLite}
      canSetBudget={can(actor, "finance.write")}
      defaultOpen={sp.novo === "1"}
      trigger={
        <Button variant="primary">
          <Plus /> Novo projeto
        </Button>
      }
    />
  ) : null;

  return (
    <>
      <PageHeader
        title="Projetos"
        description="Acompanhe status, prazos, equipe e progresso de cada projeto."
        actions={newButton}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <FilterBar>
            <SearchFilter placeholder="Buscar projeto" />
            <SelectFilter
              param="clientId"
              label="Cliente"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
            <SelectFilter
              param="statusId"
              label="Status"
              options={statuses.map((st) => ({ value: st.id, label: st.name }))}
            />
            <SelectFilter
              param="ownerId"
              label="Responsável"
              options={members.map((m) => ({ value: m.membershipId, label: m.name }))}
            />
            <SelectFilter param="priority" label="Prioridade" options={PRIORITY_OPTIONS} />
            <DateFilter param="from" label="De" />
            <DateFilter param="to" label="Até" />
            <ClearFilters keys={["q", "clientId", "statusId", "ownerId", "priority", "from", "to"]} />
          </FilterBar>
          <ViewSwitcher basePath={basePath} searchParams={sp} />
        </div>
      </PageHeader>
      <ProjectsView
        view={filters.view}
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        statuses={statuses}
        orgSlug={actor.orgSlug}
        basePath={basePath}
        searchParams={sp}
        canMove={canWrite}
        emptyAction={newButton}
      />
    </>
  );
}
