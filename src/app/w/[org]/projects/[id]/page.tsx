import { InfoList } from "@/components/app/stat";
import { ProjectEditDialog } from "@/components/projects/project-edit-dialog";
import { ProjectStages } from "@/components/projects/project-stages";
import { ProjectTeam } from "@/components/projects/project-team";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listInternalMembers } from "@/server/services/members";
import { getProject } from "@/server/services/projects";

export default async function ProjectOverviewPage({ params }: PageProps<"/w/[org]/projects/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "projects.read" });
  const { detail, members } = await inOrg(actor, async (s) => ({
    detail: await getProject(s, id),
    members: await listInternalMembers(s),
  }));
  const { project, stages, members: team, ownerName, clientName } = detail;
  const canWrite = can(actor, "projects.write");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sobre o projeto</CardTitle>
            {canWrite ? (
              <ProjectEditDialog
                project={project}
                members={members.map((m) => ({ membershipId: m.membershipId, name: m.name }))}
                canSetBudget={can(actor, "finance.write")}
              />
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <p className="text-xs text-fg-subtle">Objetivo</p>
              <p className="mt-0.5 text-sm">
                {project.objective ?? <span className="text-fg-subtle">Não definido</span>}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-subtle">Descrição</p>
              <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
                {project.description ?? <span className="text-fg-subtle">Sem descrição</span>}
              </p>
            </div>
          </CardContent>
        </Card>
        <ProjectStages projectId={id} stages={stages} canWrite={canWrite} />
      </div>
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Informações</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoList
              items={[
                { label: "Cliente", value: clientName },
                { label: "Responsável", value: ownerName },
                { label: "Início", value: project.startDate ? formatDate(project.startDate) : null },
                { label: "Prazo", value: project.dueDate ? formatDate(project.dueDate) : null },
                { label: "Criado em", value: formatDate(project.createdAt) },
                ...(project.completedAt ? [{ label: "Concluído em", value: formatDate(project.completedAt) }] : []),
                ...(can(actor, "finance.read")
                  ? [
                      {
                        label: "Orçamento",
                        value: project.budgetCents != null ? formatMoney(project.budgetCents) : null,
                      },
                    ]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
        <ProjectTeam
          projectId={id}
          team={team}
          ownerId={project.ownerMembershipId}
          members={members.map((m) => ({
            membershipId: m.membershipId,
            name: m.name,
            image: m.image,
            jobTitle: m.jobTitle,
            roleName: m.roleName,
          }))}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
