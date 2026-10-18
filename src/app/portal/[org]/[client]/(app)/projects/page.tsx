import { FolderKanban } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { listProjects } from "@/server/services/projects";

export const metadata: Metadata = { title: "Projetos" };

export default async function PortalProjectsPage({ params }: PageProps<"/portal/[org]/[client]/projects">) {
  const { org, client: clientSlug } = await params;
  const portal = await requirePortal(org, clientSlug, { permission: "projects.read" });
  const { actor } = portal;
  const { rows } = await inOrg(actor, (s) => listProjects(s, { view: "board" }));
  const showProgress = actor.settings.portal.showProjectProgress;
  const multiClient = actor.clientIds.length > 1;
  return (
    <>
      <PageHeader title="Projetos" description="Acompanhe o andamento do que a agência está produzindo para você." />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={FolderKanban}
            title="Nenhum projeto em andamento"
            description="Quando a agência iniciar um projeto, ele aparece aqui."
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => {
            const pct = p.tasksTotal ? Math.round((p.tasksDone / p.tasksTotal) * 100) : 0;
            return (
              <li key={p.id}>
                <Link
                  href={`${portal.base}/projects/${p.id}`}
                  className="block h-full rounded-xl border border-border bg-surface p-4 shadow-xs transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{p.name}</p>
                    <StatusBadge name={p.statusName} color={p.statusColor} />
                  </div>
                  {multiClient ? <p className="mt-0.5 text-xs text-fg-muted">{p.clientName}</p> : null}
                  {showProgress ? (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-fg-muted">
                        <span>Andamento</span>
                        <span className="tabular">{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <DueDate date={p.dueDate} done={!!p.completedAt} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
