import { AlertTriangle, CheckCheck, FolderKanban, Inbox, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { PriorityIcon } from "@/components/app/priority";
import { Stat, StatGrid } from "@/components/app/stat";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatPercent, relativeFromNow } from "@/lib/format";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getDashboard, type DashboardData } from "@/server/services/dashboard";

export const metadata: Metadata = { title: "Início" };

const LONG_DATE = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    ),
  );
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function TaskGroup({
  title,
  items,
  base,
  tone,
}: {
  title: string;
  items: DashboardData["tasks"]["today"];
  base: string;
  tone?: "danger";
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`mb-1.5 text-xs font-medium ${tone === "danger" ? "text-danger" : "text-fg-subtle"}`}>
        {title} · {items.length}
      </p>
      <ul className="grid">
        {items.map((t) => (
          <li key={t.id}>
            <Link
              href={`${base}/tasks/${t.id}`}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
            >
              <StatusDot color={t.statusColor} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{t.title}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {t.projectName} · {t.clientName}
                </span>
              </span>
              <PriorityIcon priority={t.priority} />
              <DueDate date={t.dueDate} icon={false} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function DashboardPage({ params }: PageProps<"/w/[org]">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal" });
  const d = await inOrg(actor, (s) => getDashboard(s));
  const base = `/w/${actor.orgSlug}`;
  const myCount = d.tasks.overdue.length + d.tasks.today.length + d.tasks.upcoming.length;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <p className="text-sm text-fg-muted first-letter:uppercase">{LONG_DATE.format(new Date())}</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
          {greeting()}, {actor.name.split(" ")[0]}
        </h1>
      </div>

      {d.kpis ? (
        <StatGrid>
          <Stat label="Projetos ativos" value={d.kpis.activeProjects} href={`${base}/projects`} />
          <Stat
            label="Tarefas atrasadas"
            value={d.kpis.overdueTasks}
            tone={d.kpis.overdueTasks ? "danger" : undefined}
            href={`${base}/reports`}
          />
          <Stat
            label="Aprovações pendentes"
            value={d.kpis.pendingInternal + d.kpis.pendingClient}
            hint={`${d.kpis.pendingInternal} internas · ${d.kpis.pendingClient} com o cliente`}
            href={`${base}/approvals`}
          />
          {d.kpis.mrrCents !== null ? (
            <Stat
              label="Receita recorrente"
              value={formatMoney(d.kpis.mrrCents)}
              hint="Mensal, contratos ativos"
              href={`${base}/finance`}
            />
          ) : (
            <Stat label="Equipe ativa" value={d.kpis.members} href={`${base}/team`} />
          )}
        </StatGrid>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-1 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Minhas tarefas</CardTitle>
              <Link href={`${base}/tasks`} className="text-xs text-fg-muted hover:text-fg">
                Ver todas
              </Link>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4">
              {myCount === 0 ? (
                <EmptyState
                  compact
                  icon={ListChecks}
                  title="Nada com prazo para os próximos 7 dias"
                  description={
                    d.tasks.withoutDue
                      ? `Você tem ${d.tasks.withoutDue} tarefa(s) aberta(s) sem prazo.`
                      : "Quando alguém atribuir uma tarefa a você, ela aparece aqui."
                  }
                />
              ) : (
                <>
                  <TaskGroup title="Atrasadas" items={d.tasks.overdue} base={base} tone="danger" />
                  <TaskGroup title="Hoje" items={d.tasks.today} base={base} />
                  <TaskGroup title="Próximos 7 dias" items={d.tasks.upcoming} base={base} />
                  {d.tasks.withoutDue ? (
                    <p className="text-xs text-fg-subtle">+ {d.tasks.withoutDue} sem prazo definido</p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" aria-hidden="true" /> Projetos em risco
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d.projectsAtRisk.length === 0 ? (
                <EmptyState
                  compact
                  icon={FolderKanban}
                  title="Nenhum projeto em risco"
                  description="Projetos com tarefas atrasadas ou prazo próximo e pouco avanço aparecem aqui."
                />
              ) : (
                <ul className="grid divide-y divide-border">
                  {d.projectsAtRisk.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`${base}/projects/${p.id}`}
                        className="flex items-center gap-4 py-2.5 hover:opacity-80"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{p.clientName}</span>
                        </span>
                        <span className="hidden w-28 sm:block">
                          <span className="flex justify-between text-[11px] text-fg-subtle">
                            <span>Progresso</span>
                            <span className="tabular">{p.total ? formatPercent(p.progress) : "—"}</span>
                          </span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${Math.round(p.progress * 100)}%` }}
                            />
                          </span>
                        </span>
                        <span className="text-right text-xs">
                          {p.overdue ? (
                            <span className="block font-medium text-danger">{p.overdue} atrasada(s)</span>
                          ) : null}
                          <DueDate date={p.dueDate} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 content-start gap-6">
          {actor.permissions.has("approvals.decide_internal") ? (
            <Card>
              <CardHeader>
                <CardTitle>Aguardando sua revisão</CardTitle>
                <Link href={`${base}/approvals`} className="text-xs text-fg-muted hover:text-fg">
                  Aprovações
                </Link>
              </CardHeader>
              <CardContent>
                {d.approvals.length === 0 ? (
                  <EmptyState compact icon={CheckCheck} title="Nenhuma revisão interna pendente" />
                ) : (
                  <ul className="grid divide-y divide-border">
                    {d.approvals.map((a) => (
                      <li key={a.id}>
                        <Link href={`${base}/files/${a.fileId}`} className="block py-2.5 hover:opacity-80">
                          <span className="block truncate text-sm font-medium">{a.fileName}</span>
                          <span className="block truncate text-xs text-fg-muted">
                            {[
                              a.projectName ?? a.clientName,
                              a.requestedBy ? `por ${a.requestedBy}` : null,
                              relativeFromNow(a.requestedAt),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {actor.permissions.has("requests.triage") ? (
            <Card>
              <CardHeader>
                <CardTitle>Solicitações para triagem</CardTitle>
                <Link href={`${base}/requests`} className="text-xs text-fg-muted hover:text-fg">
                  Solicitações
                </Link>
              </CardHeader>
              <CardContent>
                {d.requests.length === 0 ? (
                  <EmptyState compact icon={Inbox} title="Nenhuma solicitação esperando triagem" />
                ) : (
                  <ul className="grid divide-y divide-border">
                    {d.requests.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`${base}/requests/${r.id}`}
                          className="flex items-center gap-3 py-2.5 hover:opacity-80"
                        >
                          <PriorityIcon priority={r.priority} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              #{r.number} · {r.title}
                            </span>
                            <span className="block truncate text-xs text-fg-muted">
                              {r.clientName} · {relativeFromNow(r.createdAt)}
                            </span>
                          </span>
                          {r.desiredDueDate ? <DueDate date={r.desiredDueDate} /> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Atividade recente</CardTitle>
            </CardHeader>
            <CardContent>
              {d.activity.length === 0 ? (
                <p className="text-sm text-fg-muted">Nada por aqui ainda.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-3">
                  {d.activity.map((a) => (
                    <li key={a.id} className="flex gap-3">
                      <Avatar name={a.actorName ?? "Sistema"} src={a.actorImage} size="sm" />
                      <p className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">{a.actorName ?? "Sistema"}</span>{" "}
                        <span className="text-fg-muted">{a.summary ?? a.action}</span>
                        <span className="block text-[11px] text-fg-subtle">{relativeFromNow(a.createdAt)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
