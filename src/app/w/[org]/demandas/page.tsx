import { CalendarDays, CheckCircle2, List, Plus, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SearchFilter, SelectFilter } from "@/components/app/filters";
import { DemandsWeek } from "@/components/tasks/demands-week";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TaskListTable } from "@/components/tasks/task-list-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { cn } from "@/lib/utils";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import {
  DEMAND_FILTERS,
  demandIndicators,
  listDemands,
  resolveDemandOwner,
  type DemandFilter,
} from "@/server/services/demands";
import { listInternalMembers } from "@/server/services/members";
import { projectOptions } from "@/server/services/projects";
import { listStatuses, listTransitions } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Minhas demandas" };

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

const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

/**
 * Minhas demandas: o que está com a pessoa agora. Indicadores clicáveis
 * (filtram a lista), Lista ou Minha semana, organizadas por etapa do fluxo ou
 * por prazo. São as mesmas tarefas da central — mudar aqui muda lá.
 */
export default async function DemandsPage({ params, searchParams }: PageProps<"/w/[org]/demandas">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const visao = pick("visao") === "semana" ? "semana" : "lista";
  const ordem = pick("ordem") === "prazo" ? "prazo" : "etapa";
  const filtro: DemandFilter = DEMAND_FILTERS.includes(pick("filtro") as DemandFilter)
    ? (pick("filtro") as DemandFilter)
    : "abertas";
  const canAssign = can(actor, "tasks.assign");
  const canWrite = can(actor, "tasks.write");
  const q = pick("q");

  const data = await inOrg(actor, async (s) => {
    const owner = await resolveDemandOwner(s, canAssign ? pick("pessoa") : undefined).catch(
      () => s.actor.membershipId,
    );
    return {
      owner,
      indicators: await demandIndicators(s, owner),
      // Na semana, o indicador escolhido também vale; a busca sempre.
      rows: await listDemands(s, { membershipId: owner, filter: filtro, q }),
      statuses: await listStatuses(s, "task"),
      transitions: await listTransitions(s),
      members: await listInternalMembers(s),
      projects: canWrite ? await projectOptions(s) : [],
    };
  });

  const base = `/w/${actor.orgSlug}`;
  const path = `${base}/demandas`;
  const isMe = data.owner === actor.membershipId;
  const ownerName = isMe ? actor.name : (data.members.find((m) => m.membershipId === data.owner)?.name ?? "—");
  const memberLite = data.members.map((m) => ({
    membershipId: m.membershipId,
    name: m.name,
    image: m.image,
    jobTitle: m.jobTitle,
    roleName: m.roleName,
  }));
  const statusOpts = data.statuses.map((st) => ({ id: st.id, name: st.name, color: st.color }));
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") next.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const rows =
    ordem === "prazo"
      ? [...data.rows].sort(
          (a, b) =>
            (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
            PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
        )
      : data.rows;

  const newDemand = (label = "Nova demanda") =>
    canWrite ? (
      <TaskFormDialog
        noun="demanda"
        // Fica nesta tela depois de criar: a lista atualiza e a demanda aparece (sem tirar a pessoa do contexto).
        openAfterCreate={false}
        projects={data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName, clientId: p.clientId }))}
        members={memberLite}
        defaultAssigneeId={data.owner}
        trigger={
          <Button variant="primary">
            <Plus /> {label}
          </Button>
        }
      />
    ) : null;

  const ind = data.indicators;
  const kpis: { key: DemandFilter; label: string; value: number; tone?: "danger" | "warning" }[] = [
    { key: "atrasadas", label: "Atrasadas", value: ind.overdue, tone: "danger" },
    { key: "hoje", label: "Para hoje", value: ind.today, tone: "warning" },
    { key: "semana", label: "Próximos 7 dias", value: ind.week },
    { key: "abertas", label: "Todas abertas", value: ind.open },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-fg-subtle uppercase">Minhas demandas</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {isMe ? `${greeting()}, ${actor.name.split(" ")[0]}!` : `Demandas de ${ownerName}`}
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted first-letter:uppercase">{LONG_DATE.format(new Date())}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchFilter placeholder="Buscar demanda" className="sm:w-56" />
          {canAssign ? (
            <SelectFilter
              param="pessoa"
              label={`Ver como: ${actor.name.split(" ")[0]} (eu)`}
              options={data.members
                .filter((m) => m.membershipId !== actor.membershipId)
                .map((m) => ({ value: m.membershipId, label: `Ver como: ${m.name}` }))}
            />
          ) : null}
          <Button variant="secondary" size="icon" asChild>
            <Link
              href={`${base}/tasks?view=list&open=1&assignee=${isMe ? "me" : data.owner}`}
              aria-label="Filtros avançados (Tarefas da equipe)"
              title="Filtros avançados (Tarefas da equipe)"
            >
              <SlidersHorizontal />
            </Link>
          </Button>
          {newDemand()}
        </div>
      </header>

      <nav aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => {
          const active = filtro === k.key;
          return (
            <Link
              key={k.key}
              href={href({ filtro: k.key === "abertas" ? null : k.key })}
              aria-current={active ? "true" : undefined}
              data-testid={`kpi-${k.key}`}
              className={cn(
                "rounded-xl border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong",
                active ? "border-accent ring-1 ring-accent" : "border-border",
              )}
            >
              <p
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  k.tone === "danger" && k.value ? "text-danger" : k.tone === "warning" && k.value ? "text-warning" : "",
                )}
              >
                {k.value}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">{k.label}</p>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedNav
          param="visao"
          items={[
            { label: "Lista", value: "lista", href: href({ visao: null }), icon: <List /> },
            { label: "Minha semana", value: "semana", href: href({ visao: "semana" }), icon: <CalendarDays /> },
          ]}
        />
        <SegmentedNav
          param="ordem"
          items={[
            { label: "Por etapa", value: "etapa", href: href({ ordem: null }) },
            { label: "Por prazo", value: "prazo", href: href({ ordem: "prazo" }) },
          ]}
        />
      </div>

      {ind.open === 0 && !q ? (
        <Card className="border-dashed">
          <EmptyState
            icon={CheckCircle2}
            title={isMe ? "Tudo em dia — nenhuma demanda aberta para você." : `Nenhuma demanda aberta para ${ownerName}.`}
            description="Quando uma demanda for atribuída, ela aparece aqui por etapa ou por prazo."
            action={newDemand("Criar demanda")}
          />
        </Card>
      ) : visao === "semana" ? (
        <DemandsWeek
          rows={rows}
          statuses={statusOpts}
          order={ordem}
          base={base}
          canWrite={canWrite}
          listHref={href({ visao: null })}
        />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={CheckCircle2}
            title={q ? "Nenhuma demanda encontrada" : "Nada neste indicador"}
            description={
              q ? "Ajuste a busca." : "Escolha outro indicador acima para ver as demais demandas abertas."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden" data-testid="demands-list">
          <TaskListTable
            rows={rows}
            statuses={statusOpts}
            transitions={data.transitions}
            members={memberLite}
            base={base}
            canWrite={canWrite}
            canAssign={canAssign}
            groupBy={ordem === "etapa" ? "status" : "due"}
          />
        </Card>
      )}
    </div>
  );
}
