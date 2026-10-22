import {
  AlertTriangle,
  CalendarDays,
  CheckCheck,
  FolderKanban,
  FolderOpen,
  ImagePlus,
  Inbox,
  LayoutGrid,
  Layers,
  List,
  Palette,
  Plus,
  Share2,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { OrgAvatar } from "@/components/brand/org-avatar";
import { PriorityIcon } from "@/components/app/priority";
import { Stat, StatGrid } from "@/components/app/stat";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatPercent, relativeFromNow, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getDashboard, type DashboardData } from "@/server/services/dashboard";
import { demandIndicators } from "@/server/services/demands";
import { listInternalMembers } from "@/server/services/members";
import { projectOptions } from "@/server/services/projects";

export const metadata: Metadata = { title: "Dashboard" };

const LONG_DATE = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});
const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", timeZone: "UTC" });

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    ),
  );
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Destino de cada item do histórico (só o que tem página própria). */
function activityHref(base: string, a: DashboardData["activity"][number]) {
  if (!a.entityId) return null;
  switch (a.entityType) {
    case "client":
      return `${base}/clients/${a.entityId}`;
    case "project":
      return `${base}/projects/${a.entityId}`;
    case "task":
      return `${base}/tasks/${a.entityId}`;
    case "request":
      return `${base}/requests/${a.entityId}`;
    case "file":
      return `${base}/files/${a.entityId}`;
    case "approval":
      return `${base}/approvals`;
    case "invoice":
      return `${base}/finance/invoices`;
    default:
      return null;
  }
}

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage({ params, searchParams }: PageProps<"/w/[org]">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal" });
  const canTasks = can(actor, "tasks.read");
  const canWriteTasks = can(actor, "tasks.write");
  const { d, demand, projects, members } = await inOrg(actor, async (s) => ({
    d: await getDashboard(s),
    demand: canTasks ? await demandIndicators(s, s.actor.membershipId) : null,
    projects: canWriteTasks ? await projectOptions(s) : [],
    members: canWriteTasks ? await listInternalMembers(s) : [],
  }));
  const base = `/w/${actor.orgSlug}`;
  const today = todayISO();
  const projectsAsList = sp.projetos === "lista";

  const summary = demand
    ? [
        demand.today ? `${demand.today} para entregar hoje` : "nada para entregar hoje",
        demand.overdue ? `${demand.overdue} atrasada(s)` : null,
        d.approvals.length ? `${d.approvals.length} revisão(ões) esperando você` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const quick = [
    { show: can(actor, "projects.write"), label: "Criar projeto", href: `${base}/projects?novo=1`, icon: FolderKanban },
    {
      show: can(actor, "designs.write") && can(actor, "ai.use"),
      label: "Criar carrossel",
      href: `${base}/studio/gerar`,
      icon: Layers,
    },
    { show: can(actor, "designs.read"), label: "Abrir editor", href: `${base}/studio`, icon: Palette },
    { show: can(actor, "ai.use"), label: "Gerar imagem com IA", href: `${base}/ai?ferramenta=imagem`, icon: ImagePlus },
    { show: can(actor, "content.read"), label: "Criar conteúdo", href: `${base}/content`, icon: Share2 },
    { show: can(actor, "files.read"), label: "Abrir arquivos", href: `${base}/files`, icon: FolderOpen },
  ].filter((q) => q.show);

  // Agenda: minhas entregas (atrasadas, hoje e próximos dias) e prazos de projetos, por dia.
  const agendaTasks = [...d.tasks.overdue, ...d.tasks.today, ...d.tasks.upcoming];
  const agendaDays = Array.from({ length: 7 }, (_, i) => plusDays(today, i)).map((day) => ({
    day,
    tasks: agendaTasks.filter((t) => t.dueDate === day),
    projects: d.deadlines.filter((p) => p.dueDate === day),
  }));
  const overdueTasks = d.tasks.overdue;
  const laterDeadlines = d.deadlines.filter((p) => p.dueDate && p.dueDate > plusDays(today, 6));

  const newDemand =
    canWriteTasks && canTasks ? (
      <TaskFormDialog
        noun="demanda"
        openAfterCreate={false}
        projects={projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName, clientId: p.clientId }))}
        members={members.map((m) => ({
          membershipId: m.membershipId,
          name: m.name,
          image: m.image,
          jobTitle: m.jobTitle,
          roleName: m.roleName,
        }))}
        trigger={
          <Button variant="primary">
            <Plus /> Nova demanda
          </Button>
        }
      />
    ) : null;

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Boas-vindas */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {actor.orgLogoSrc ? (
            <OrgAvatar name={actor.orgName} src={actor.orgLogoSrc} size="xl" className="hidden sm:inline-flex" />
          ) : null}
          <div className="min-w-0">
            <p className="text-sm text-fg-muted first-letter:uppercase">
              {LONG_DATE.format(new Date())}
              <span className="hidden sm:inline"> · {actor.orgName}</span>
            </p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
              {greeting()}, {actor.name.split(" ")[0]}
            </h1>
            {summary ? <p className="mt-0.5 text-sm text-fg-muted first-letter:uppercase">{summary}.</p> : null}
          </div>
        </div>
        {newDemand}
      </header>

      {/* Acesso rápido */}
      {quick.length ? (
        <nav aria-label="Acesso rápido" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {quick.map((q) => (
            <Link
              key={q.label}
              href={q.href}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-xs transition-colors hover:border-border-strong"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg">
                <q.icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 text-sm leading-tight font-medium">{q.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {/* Indicadores das minhas demandas (os mesmos de Minhas demandas) */}
      {demand ? (
        <StatGrid>
          <Stat
            label="Atrasadas"
            value={demand.overdue}
            tone={demand.overdue ? "danger" : undefined}
            href={`${base}/demandas?filtro=atrasadas`}
          />
          <Stat
            label="Para hoje"
            value={demand.today}
            tone={demand.today ? "warning" : undefined}
            href={`${base}/demandas?filtro=hoje`}
          />
          <Stat label="Próximos 7 dias" value={demand.week} href={`${base}/demandas?filtro=semana`} />
          <Stat label="Todas abertas" value={demand.open} href={`${base}/demandas`} />
        </StatGrid>
      ) : null}

      {/* Ferramentas principais */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {d.studio ? (
          <Card className="xl:col-span-2" data-testid="dashboard-studio">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="size-4 text-fg-subtle" aria-hidden="true" /> Estúdio de Carrosséis
                </CardTitle>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {d.studio.carouselsInProgress} carrossel(is) em andamento
                  {d.studio.approvedThisMonth !== null
                    ? ` · ${d.studio.approvedThisMonth} material(is) aprovado(s) pelo cliente neste mês`
                    : ""}
                </p>
              </div>
              <Link href={`${base}/studio`} className="text-xs text-fg-muted hover:text-fg">
                Abrir Estúdio
              </Link>
            </CardHeader>
            <CardContent>
              {d.studio.recent.length === 0 ? (
                <EmptyState
                  compact
                  icon={Palette}
                  title="Nenhuma arte ainda"
                  description="Crie uma arte ou gere um carrossel com IA para começar."
                  action={
                    can(actor, "designs.write") ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`${base}/studio`}>Abrir o Estúdio</Link>
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {d.studio.recent.map((x) => (
                    <li key={x.id}>
                      <Link
                        href={`${base}/studio/${x.id}`}
                        className="group block overflow-hidden rounded-lg border border-border transition-colors hover:border-border-strong"
                      >
                        <span className="flex aspect-[4/5] items-center justify-center bg-surface-2">
                          {x.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element -- miniatura em data URL salva pelo editor
                            <img src={x.thumbnail} alt="" className="size-full object-contain" />
                          ) : (
                            <Palette className="size-6 text-fg-subtle" aria-hidden="true" />
                          )}
                        </span>
                        <span className="block px-2 py-1.5">
                          <span className="block truncate text-xs font-medium group-hover:underline">{x.name}</span>
                          <span className="block truncate text-[11px] text-fg-subtle">
                            {x.pageCount > 1 ? `${x.pageCount} páginas · ` : ""}
                            {relativeFromNow(x.updatedAt)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {d.ai ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4 text-fg-subtle" aria-hidden="true" /> Criação com IA
                </CardTitle>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {d.ai.total
                    ? `${d.ai.total} geração(ões) suas neste mês${d.ai.images ? `, ${d.ai.images} imagem(ns)` : ""}.`
                    : "Nenhuma geração sua neste mês ainda."}
                </p>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Link
                href={`${base}/ai`}
                className="rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-border-strong"
              >
                <span className="font-medium">Textos e ideias</span>
                <span className="block text-xs text-fg-muted">Roteiros, legendas, planejamentos e revisões.</span>
              </Link>
              <Link
                href={`${base}/ai?ferramenta=imagem`}
                className="rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-border-strong"
              >
                <span className="font-medium">Imagens</span>
                <span className="block text-xs text-fg-muted">Geradas e salvas nos arquivos do cliente.</span>
              </Link>
              {can(actor, "designs.write") ? (
                <Link
                  href={`${base}/studio/gerar`}
                  className="rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-border-strong"
                >
                  <span className="font-medium">Carrossel completo</span>
                  <span className="block text-xs text-fg-muted">Narrativa, identidade e slides editáveis.</span>
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {can(actor, "projects.read") ? (
        <Card data-testid="dashboard-projects">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="size-4 text-fg-subtle" aria-hidden="true" /> Projetos recentes
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Visualização">
                <Link
                  href={`${base}`}
                  aria-label="Grade"
                  aria-current={!projectsAsList ? "true" : undefined}
                  className={cn("rounded p-1 text-fg-muted hover:text-fg", !projectsAsList && "bg-surface-2 text-fg")}
                >
                  <LayoutGrid className="size-3.5" />
                </Link>
                <Link
                  href={`${base}?projetos=lista`}
                  aria-label="Lista"
                  aria-current={projectsAsList ? "true" : undefined}
                  className={cn("rounded p-1 text-fg-muted hover:text-fg", projectsAsList && "bg-surface-2 text-fg")}
                >
                  <List className="size-3.5" />
                </Link>
              </div>
              <Link href={`${base}/projects`} className="text-xs text-fg-muted hover:text-fg">
                Ver todos
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {d.recentProjects.length === 0 ? (
              <EmptyState
                compact
                icon={FolderKanban}
                title="Nenhum projeto ainda"
                description="Crie um projeto para organizar demandas, artes e entregas de um cliente."
                action={
                  can(actor, "projects.write") ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`${base}/projects?novo=1`}>Criar projeto</Link>
                    </Button>
                  ) : null
                }
              />
            ) : projectsAsList ? (
              <ul className="grid grid-cols-1 divide-y divide-border">
                {d.recentProjects.map((p) => (
                  <li key={p.id}>
                    <Link href={`${base}/projects/${p.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2">
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" className="size-full object-cover" />
                        ) : (
                          <FolderKanban className="size-4 text-fg-subtle" aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-fg-muted">
                          {p.clientName} · {p.openTasks} demanda(s) aberta(s) · {p.designCount} arte(s)
                        </span>
                      </span>
                      <span className="hidden items-center gap-1.5 text-xs text-fg-muted sm:flex">
                        <StatusDot color={p.statusColor} /> {p.statusName}
                      </span>
                      <span className="w-24 text-right text-xs text-fg-subtle">{relativeFromNow(p.lastActivity)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {d.recentProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`${base}/projects/${p.id}`}
                      className="group block overflow-hidden rounded-lg border border-border transition-colors hover:border-border-strong"
                    >
                      <span className="flex aspect-video items-center justify-center bg-surface-2">
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" className="size-full object-cover" />
                        ) : (
                          <FolderKanban className="size-5 text-fg-subtle" aria-hidden="true" />
                        )}
                      </span>
                      <span className="block px-2.5 py-2">
                        <span className="block truncate text-sm font-medium group-hover:underline">{p.name}</span>
                        <span className="block truncate text-xs text-fg-muted">{p.clientName}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
                          <StatusDot color={p.statusColor} />
                          <span className="truncate">{p.statusName}</span>
                          <span className="ml-auto shrink-0">{relativeFromNow(p.lastActivity)}</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {d.kpis ? (
        <StatGrid>
          <Stat label="Projetos ativos" value={d.kpis.activeProjects} href={`${base}/projects`} />
          <Stat
            label="Tarefas atrasadas da equipe"
            value={d.kpis.overdueTasks}
            tone={d.kpis.overdueTasks ? "danger" : undefined}
            href={`${base}/tasks?view=list&due=overdue`}
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
          {canTasks ? (
            <Card data-testid="dashboard-agenda">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-fg-subtle" aria-hidden="true" /> Agenda dos próximos dias
                </CardTitle>
                <Link href={`${base}/tasks?view=calendar`} className="text-xs text-fg-muted hover:text-fg">
                  Calendário completo
                </Link>
              </CardHeader>
              <CardContent className="grid gap-4">
                {overdueTasks.length ? (
                  <AgendaGroup title="Atrasadas" tone="danger" base={base} tasks={overdueTasks} projects={[]} />
                ) : null}
                {agendaDays.every((g) => !g.tasks.length && !g.projects.length) && !overdueTasks.length ? (
                  <EmptyState
                    compact
                    icon={CalendarDays}
                    title="Nada com prazo para os próximos 7 dias"
                    description={
                      d.tasks.withoutDue
                        ? `Você tem ${d.tasks.withoutDue} demanda(s) aberta(s) sem prazo.`
                        : "Entregas e prazos de projetos aparecem aqui, dia a dia."
                    }
                  />
                ) : (
                  agendaDays
                    .filter((g) => g.tasks.length || g.projects.length)
                    .map((g) => (
                      <AgendaGroup
                        key={g.day}
                        title={
                          g.day === today
                            ? "Hoje"
                            : g.day === plusDays(today, 1)
                              ? "Amanhã"
                              : WEEKDAY.format(new Date(`${g.day}T12:00:00Z`))
                        }
                        base={base}
                        tasks={g.tasks}
                        projects={g.projects}
                      />
                    ))
                )}
                {laterDeadlines.length ? (
                  <p className="text-xs text-fg-subtle">
                    Próximos prazos de projeto: {laterDeadlines.map((p) => p.name).join(", ")}.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {d.projectsAtRisk.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-warning" aria-hidden="true" /> Projetos em risco
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-1 divide-y divide-border">
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
              </CardContent>
            </Card>
          ) : null}
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
                  <ul className="grid grid-cols-1 divide-y divide-border">
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
                  <ul className="grid grid-cols-1 divide-y divide-border">
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
                <ul className="grid grid-cols-1 gap-1" data-testid="dashboard-activity">
                  {d.activity.map((a) => {
                    const href = activityHref(base, a);
                    const body = (
                      <>
                        <Avatar name={a.actorName ?? "Sistema"} src={a.actorImage} size="sm" />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{a.actorName ?? "Sistema"}</span>{" "}
                          <span className="text-fg-muted">{a.summary ?? a.action}</span>
                          <span className="block text-[11px] text-fg-subtle">{relativeFromNow(a.createdAt)}</span>
                        </span>
                      </>
                    );
                    return (
                      <li key={a.id}>
                        {href ? (
                          <Link href={href} className="-mx-2 flex gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
                            {body}
                          </Link>
                        ) : (
                          <div className="flex gap-3 py-1.5">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AgendaGroup({
  title,
  tone,
  base,
  tasks,
  projects,
}: {
  title: string;
  tone?: "danger";
  base: string;
  tasks: DashboardData["tasks"]["today"];
  projects: DashboardData["deadlines"];
}) {
  return (
    <div>
      <p className={cn("mb-1.5 text-xs font-medium", tone === "danger" ? "text-danger" : "text-fg-subtle")}>
        {title} · {tasks.length + projects.length}
      </p>
      <ul className="grid grid-cols-1">
        {projects.map((p) => (
          <li key={`p-${p.id}`}>
            <Link
              href={`${base}/projects/${p.id}`}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
            >
              <FolderKanban className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">Prazo do projeto: {p.name}</span>
                <span className="block truncate text-xs text-fg-muted">{p.clientName}</span>
              </span>
            </Link>
          </li>
        ))}
        {tasks.map((t) => (
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
