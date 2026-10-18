import { Check, Circle, CircleDot } from "lucide-react";
import { notFound } from "next/navigation";
import { Comments } from "@/components/app/comments";
import { DueDate } from "@/components/app/due-date";
import { HistoryList } from "@/components/app/history-list";
import { StatusBadge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { NotFoundError } from "@/server/errors";
import { listComments } from "@/server/services/comments";
import { getProject, projectHistory } from "@/server/services/projects";

export default async function PortalProjectPage({ params }: PageProps<"/portal/[org]/[client]/projects/[id]">) {
  const { org, client: clientSlug, id } = await params;
  const portal = await requirePortal(org, clientSlug, { permission: "projects.read" });
  const { actor } = portal;
  const data = await inOrg(actor, async (s) => {
    try {
      return {
        detail: await getProject(s, id),
        history: await projectHistory(s, id, 30),
        comments: await listComments(s, { projectId: id }),
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { project, status, stages, tasks } = data.detail;
  const showProgress = actor.settings.portal.showProjectProgress;
  const pct = tasks.total ? Math.round((tasks.done / tasks.total) * 100) : 0;
  return (
    <div className="grid gap-6">
      <div>
        <Breadcrumbs items={[{ label: "Projetos", href: `${portal.base}/projects` }, { label: project.name }]} />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
          <StatusBadge name={status.name} color={status.color} />
          <DueDate date={project.dueDate} done={!!project.completedAt} />
        </div>
        {project.objective ? <p className="mt-1 text-sm text-fg-muted">{project.objective}</p> : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="grid content-start gap-6">
          {showProgress ? (
            <Card>
              <CardHeader>
                <CardTitle>Andamento</CardTitle>
                <span className="tabular text-sm font-semibold">{pct}%</span>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                {stages.length ? (
                  <ol className="grid gap-2">
                    {stages.map((st) => (
                      <li key={st.id} className="flex items-center gap-3 text-sm">
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full border",
                            st.status === "done" && "border-success bg-success text-white",
                            st.status === "active" && "border-accent text-accent-text",
                            st.status === "pending" && "border-border-strong text-fg-subtle",
                          )}
                        >
                          {st.status === "done" ? (
                            <Check className="size-3" />
                          ) : st.status === "active" ? (
                            <CircleDot className="size-3" />
                          ) : (
                            <Circle className="size-2.5" />
                          )}
                        </span>
                        <span
                          className={cn(
                            st.status === "done"
                              ? "text-fg-muted"
                              : st.status === "active"
                                ? "font-medium"
                                : "text-fg-muted",
                          )}
                        >
                          {st.name}
                        </span>
                        {st.completedAt ? (
                          <span className="text-xs text-fg-subtle">concluída em {formatDate(st.completedAt)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Conversa com a agência</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments
                target={{ projectId: id }}
                comments={data.comments}
                allowInternal={false}
                placeholder="Escreva uma mensagem para a equipe…"
              />
            </CardContent>
          </Card>
        </div>
        <Card className="content-start">
          <CardHeader>
            <CardTitle>Atualizações</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryList entries={data.history} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
