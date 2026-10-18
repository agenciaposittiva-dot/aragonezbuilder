import { ArrowRight, Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { Stat, StatGrid } from "@/components/app/stat";
import { ApprovalList } from "@/components/approvals/approval-list";
import { FileCollection } from "@/components/files/file-collection";
import { RequestStatusBadge } from "@/components/requests/request-status";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listApprovals } from "@/server/services/approvals";
import { listFiles } from "@/server/services/files";
import { listProjects } from "@/server/services/projects";
import { listRequests } from "@/server/services/requests";

export const metadata: Metadata = { title: "Início" };

function SeeAll({ href, label = "Ver todas" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="flex items-center gap-1 text-xs font-medium text-accent-text hover:underline">
      {label} <ArrowRight className="size-3" />
    </Link>
  );
}

export default async function PortalHomePage({ params }: PageProps<"/portal/[org]">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "client", permission: "portal.access" });
  const canApprove = can(actor, "approvals.decide_client");
  const canRequests = can(actor, "requests.read");
  const canProjects = can(actor, "projects.read");
  const canFiles = can(actor, "files.read");
  const canCreateRequest = can(actor, "requests.write") && actor.settings.portal.allowRequestCreation;
  const showProgress = actor.settings.portal.showProjectProgress;

  const data = await inOrg(actor, async (s) => ({
    approvals: canApprove && canFiles ? await listApprovals(s, { tab: "client" }) : [],
    requests: canRequests ? await listRequests(s, { open: true, pageSize: 5 }) : null,
    projects: canProjects ? await listProjects(s, { view: "board" }) : null,
    files: canFiles ? await listFiles(s, { pageSize: 6 }) : null,
  }));

  const base = `/portal/${actor.orgSlug}`;
  const activeProjects = (data.projects?.rows ?? []).filter((p) => !p.completedAt);
  const firstName = actor.name.split(" ")[0] || actor.name;
  const newRequest = canCreateRequest ? (
    <Button asChild variant="primary">
      <Link href={`${base}/requests/new`}>
        <Plus /> Nova solicitação
      </Link>
    </Button>
  ) : null;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Olá, ${firstName}`}
        description={
          data.approvals.length
            ? `${data.approvals.length === 1 ? "Há 1 material" : `Há ${data.approvals.length} materiais`} aguardando sua aprovação.`
            : `Acompanhe aqui o que a ${actor.orgName} está produzindo para você.`
        }
        actions={newRequest}
      />

      <StatGrid>
        {canApprove ? (
          <Stat
            label="Aguardando sua aprovação"
            value={data.approvals.length}
            tone={data.approvals.length ? "warning" : undefined}
            href={`${base}/approvals`}
          />
        ) : null}
        {data.requests ? (
          <Stat label="Solicitações em aberto" value={data.requests.total} href={`${base}/requests`} />
        ) : null}
        {data.projects ? (
          <Stat label="Projetos em andamento" value={activeProjects.length} href={`${base}/projects`} />
        ) : null}
        {data.files ? <Stat label="Materiais compartilhados" value={data.files.total} href={`${base}/files`} /> : null}
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="grid min-w-0 content-start gap-6">
          {canApprove ? (
            <Card>
              <CardHeader>
                <CardTitle>Aguardando sua aprovação</CardTitle>
                {data.approvals.length > 5 ? <SeeAll href={`${base}/approvals`} /> : null}
              </CardHeader>
              <ApprovalList
                rows={data.approvals.slice(0, 5)}
                emptyTitle="Tudo em dia"
                emptyDescription="Quando a agência enviar um material para você aprovar, ele aparece aqui."
              />
            </Card>
          ) : null}

          {data.files ? (
            <Card>
              <CardHeader>
                <CardTitle>Materiais recentes</CardTitle>
                {data.files.total > data.files.rows.length ? <SeeAll href={`${base}/files`} label="Ver todos" /> : null}
              </CardHeader>
              {data.files.rows.length ? (
                <FileCollection files={data.files.rows} view="grid" />
              ) : (
                <p className="px-5 pb-6 text-sm text-fg-muted">
                  Os materiais que a agência compartilhar com você aparecem aqui.
                </p>
              )}
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          {data.requests ? (
            <Card>
              <CardHeader>
                <CardTitle>Solicitações em aberto</CardTitle>
                <SeeAll href={`${base}/requests`} />
              </CardHeader>
              {data.requests.rows.length ? (
                <ul className="divide-y divide-border">
                  {data.requests.rows.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`${base}/requests/${r.id}`}
                        className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            <span className="text-fg-subtle">#{r.number}</span> {r.title}
                          </p>
                          <p className="mt-0.5 text-xs text-fg-muted">
                            {r.submittedAt ? `Enviada em ${formatDate(r.submittedAt)}` : "Rascunho"}
                          </p>
                        </div>
                        <RequestStatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Inbox}
                  title="Nenhuma solicitação em aberto"
                  description={
                    canCreateRequest ? "Precisa de algo novo? Abra uma solicitação com o briefing." : undefined
                  }
                  action={newRequest}
                />
              )}
            </Card>
          ) : null}

          {data.projects ? (
            <Card>
              <CardHeader>
                <CardTitle>Projetos</CardTitle>
                {activeProjects.length > 5 ? <SeeAll href={`${base}/projects`} label="Ver todos" /> : null}
              </CardHeader>
              {activeProjects.length ? (
                <ul className="divide-y divide-border">
                  {activeProjects.slice(0, 5).map((p) => {
                    const pct = p.tasksTotal ? Math.round((p.tasksDone / p.tasksTotal) * 100) : 0;
                    return (
                      <li key={p.id}>
                        <Link
                          href={`${base}/projects/${p.id}`}
                          className="block px-4 py-3 transition-colors hover:bg-surface-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-medium">{p.name}</p>
                            <StatusBadge name={p.statusName} color={p.statusColor} />
                          </div>
                          {showProgress ? (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="tabular text-xs text-fg-muted">{pct}%</span>
                            </div>
                          ) : null}
                          {p.dueDate ? (
                            <div className="mt-1.5">
                              <DueDate date={p.dueDate} done={!!p.completedAt} />
                            </div>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-4 pb-5 text-sm text-fg-muted">Nenhum projeto em andamento no momento.</p>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
