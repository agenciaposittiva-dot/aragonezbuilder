import { Plus } from "lucide-react";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectsView, ViewSwitcher } from "@/components/projects/projects-view";
import { Button } from "@/components/ui/button";
import { projectListParams } from "@/lib/validators/projects";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listInternalMembers } from "@/server/services/members";
import { listProjects } from "@/server/services/projects";
import { listStatuses } from "@/server/services/workflow";

export default async function ClientProjectsPage({
  params,
  searchParams,
}: PageProps<"/w/[org]/clients/[id]/projects">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "projects.read" });
  const parsed = projectListParams.safeParse({
    ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")),
    clientId: id,
  });
  const filters = parsed.success ? parsed.data : projectListParams.parse({ clientId: id });
  const { list, statuses, clients, members } = await inOrg(actor, async (s) => ({
    list: await listProjects(s, filters),
    statuses: await listStatuses(s, "project"),
    clients: await clientOptions(s),
    members: await listInternalMembers(s),
  }));
  const basePath = `/w/${actor.orgSlug}/clients/${id}/projects`;
  const canWrite = can(actor, "projects.write");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewSwitcher basePath={basePath} searchParams={sp} />
        {canWrite ? (
          <ProjectFormDialog
            clients={clients}
            defaultClientId={id}
            members={members.map((m) => ({
              membershipId: m.membershipId,
              name: m.name,
              image: m.image,
              jobTitle: m.jobTitle,
            }))}
            canSetBudget={can(actor, "finance.write")}
            trigger={
              <Button variant="primary">
                <Plus /> Novo projeto
              </Button>
            }
          />
        ) : null}
      </div>
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
        hideClient
      />
    </div>
  );
}
