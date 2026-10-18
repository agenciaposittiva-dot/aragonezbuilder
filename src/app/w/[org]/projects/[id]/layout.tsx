import Link from "next/link";
import { notFound } from "next/navigation";
import { DueDate } from "@/components/app/due-date";
import { PriorityLabel } from "@/components/app/priority";
import { ProjectMoreMenu, ProjectStatusControl } from "@/components/projects/project-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getProject } from "@/server/services/projects";
import { listStatuses, listTransitions } from "@/server/services/workflow";

export default async function ProjectLayout({ children, params }: LayoutProps<"/w/[org]/projects/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "projects.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      return {
        detail: await getProject(s, id),
        statuses: await listStatuses(s, "project"),
        transitions: await listTransitions(s),
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { project, status, clientName, ownerName, ownerImage, tasks } = data.detail;
  const allowed = data.transitions.filter((t) => t.fromStatusId === status.id).map((t) => t.toStatusId);
  const base = `/w/${actor.orgSlug}`;
  const pBase = `${base}/projects/${id}`;
  const progress = tasks.total ? Math.round((tasks.done / tasks.total) * 100) : 0;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <div className="min-w-0">
        <Breadcrumbs
          items={[
            { label: "Projetos", href: `${base}/projects` },
            { label: clientName, href: `${base}/clients/${project.clientId}` },
            { label: project.name },
          ]}
        />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
              {project.archivedAt ? <Badge tone="warning">Arquivado</Badge> : null}
              {!project.portalVisible ? <Badge tone="outline">Oculto no portal do cliente</Badge> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <ProjectStatusControl
                projectId={id}
                current={{ id: status.id, name: status.name, color: status.color }}
                statuses={data.statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
                allowedIds={allowed.length ? allowed : null}
                canWrite={can(actor, "projects.write")}
              />
              <Link href={`${base}/clients/${project.clientId}`} className="text-fg-muted hover:text-fg">
                {clientName}
              </Link>
              <PriorityLabel priority={project.priority} />
              <DueDate date={project.dueDate} done={!!project.completedAt} />
              {ownerName ? (
                <span className="flex items-center gap-1.5 text-fg-muted">
                  <Avatar name={ownerName} src={ownerImage} size="xs" /> {ownerName}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-40">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>Progresso</span>
                <span className="tabular">
                  {tasks.done}/{tasks.total} tarefas
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
              </div>
              {tasks.overdue ? <p className="mt-1 text-xs text-danger">{tasks.overdue} atrasada(s)</p> : null}
            </div>
            {can(actor, "projects.archive") || can(actor, "projects.write") || can(actor, "projects.delete") ? (
              <ProjectMoreMenu
                projectId={id}
                name={project.name}
                archived={!!project.archivedAt}
                portalVisible={project.portalVisible}
                canArchive={can(actor, "projects.archive")}
                canWrite={can(actor, "projects.write")}
                canDelete={can(actor, "projects.delete")}
              />
            ) : null}
          </div>
        </div>
      </div>
      <div className="border-b border-border">
        <UnderlineTabs
          items={[
            { label: "Visão geral", href: pBase, exact: true },
            ...(can(actor, "tasks.read") ? [{ label: "Tarefas", href: `${pBase}/tasks`, count: tasks.total }] : []),
            ...(can(actor, "files.read") ? [{ label: "Arquivos", href: `${pBase}/files` }] : []),
            ...(can(actor, "files.read") ? [{ label: "Aprovações", href: `${pBase}/approvals` }] : []),
            ...(can(actor, "costs.read") ? [{ label: "Rentabilidade", href: `${pBase}/finance` }] : []),
            { label: "Histórico", href: `${pBase}/history` },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
