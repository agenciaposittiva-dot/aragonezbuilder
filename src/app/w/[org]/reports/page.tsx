import type { Metadata } from "next";
import { BarList, Meter } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { Stat, StatGrid } from "@/components/app/stat";
import { ExportMenu } from "@/components/reports/export-menu";
import { ReportFilters } from "@/components/reports/period-filter";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatMinutes, formatMonth, formatNumber, formatPercent, formatShortDate } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { buildReport, EXPORT_TYPES } from "@/server/services/reports";

export const metadata: Metadata = { title: "Relatórios" };

function hours(h: number | null) {
  if (h === null) return "—";
  if (h < 48) return `${formatNumber(Math.round(h * 10) / 10)} h`;
  return `${formatNumber(Math.round((h / 24) * 10) / 10)} dias`;
}

function Definition({ children }: { children: React.ReactNode }) {
  return <CardDescription className="mt-0.5">{children}</CardDescription>;
}

export default async function ReportsPage({ params, searchParams }: PageProps<"/w/[org]/reports">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "reports.read" });
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const raw = { from: pick("from"), to: pick("to"), clientId: pick("clientId") };
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const { report, clients } = await inOrg(actor, async (s) => ({
    report: await buildReport(s, {
      from: valid(raw.from),
      to: valid(raw.to),
      clientId: raw.clientId && /^[0-9a-f-]{36}$/.test(raw.clientId) ? raw.clientId : undefined,
    }),
    clients: await clientOptions(s),
  }));
  const { period, tasks, approvals, requests, team, projects, weekly, ai } = report;
  const exportTypes = Object.entries(EXPORT_TYPES)
    .filter(([, v]) => !v.permission || actor.permissions.has(v.permission))
    .map(([key, v]) => ({ key, label: v.label }));

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`Indicadores operacionais de ${formatDate(period.from)} a ${formatDate(period.to)}, calculados a partir dos registros da plataforma.`}
        actions={can(actor, "reports.export") ? <ExportMenu types={exportTypes} /> : null}
      >
        <ReportFilters from={period.from} to={period.to} clients={clients} />
      </PageHeader>

      <div className="grid grid-cols-1 gap-6">
        <StatGrid>
          <Stat label="Tarefas concluídas" value={formatNumber(tasks.completed)} hint="No período (sem subtarefas)" />
          <Stat
            label="Entregues no prazo"
            value={tasks.onTimeRate === null ? "—" : formatPercent(tasks.onTimeRate)}
            hint={`${tasks.onTime} de ${tasks.completedWithDue} com prazo definido`}
          />
          <Stat
            label="Atrasadas em aberto"
            value={formatNumber(tasks.overdueOpen)}
            tone={tasks.overdueOpen ? "danger" : undefined}
            hint={`${tasks.open} tarefas abertas hoje`}
          />
          <Stat
            label="Aprovação de primeira"
            value={approvals.firstPass.rate === null ? "—" : formatPercent(approvals.firstPass.rate)}
            hint={`${approvals.firstPass.approved} de ${approvals.firstPass.total} arquivos`}
          />
        </StatGrid>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Vazão semanal</CardTitle>
                <Definition>
                  Tarefas concluídas por semana (segunda a domingo), nas 8 semanas até {formatShortDate(period.to)}.
                </Definition>
              </div>
            </CardHeader>
            <CardContent>
              <ColumnChart
                title="Tarefas concluídas por semana"
                series={[{ key: "completed", label: "Concluídas" }]}
                data={weekly.map((w) => ({ label: formatShortDate(w.week), completed: w.completed }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Aprovações</CardTitle>
                <Definition>
                  Ciclo = tempo médio entre o pedido e a decisão, para decisões no período. Aprovação de primeira =
                  arquivos cuja primeira decisão do cliente foi “aprovado”.
                </Definition>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <Table>
                <THead>
                  <tr>
                    <TH>Etapa</TH>
                    <TH className="text-right">Decididas</TH>
                    <TH className="text-right">Aprovadas</TH>
                    <TH className="text-right">Ciclo médio</TH>
                    <TH className="text-right">Pendentes agora</TH>
                  </tr>
                </THead>
                <TBody>
                  {(
                    [
                      ["Revisão interna", approvals.internal],
                      ["Cliente", approvals.client],
                    ] as const
                  ).map(([label, st]) => (
                    <TR key={label}>
                      <TD>{label}</TD>
                      <TD className="tabular text-right">{st.decided}</TD>
                      <TD className="tabular text-right">
                        {st.approved}
                        {st.decided ? (
                          <span className="ml-1 text-xs text-fg-subtle">
                            ({formatPercent(st.approved / st.decided)})
                          </span>
                        ) : null}
                      </TD>
                      <TD className="tabular text-right">{hours(st.avgHours)}</TD>
                      <TD className="tabular text-right">{st.pending}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Solicitações por status</CardTitle>
                <Definition>Solicitações criadas no período ({requests.total}), pelo status atual.</Definition>
              </div>
            </CardHeader>
            <CardContent>
              <BarList items={requests.byStatus.map((r) => ({ label: r.label, value: r.value }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Solicitações por categoria</CardTitle>
                <Definition>
                  Tempo de atendimento = média entre o envio da solicitação e a conclusão do projeto gerado por ela
                  {requests.leadTime.count
                    ? `: ${formatNumber(Math.round((requests.leadTime.avgDays ?? 0) * 10) / 10)} dias (${requests.leadTime.count} concluídas no período)`
                    : " (nenhuma concluída no período)"}
                  .
                </Definition>
              </div>
            </CardHeader>
            <CardContent>
              <BarList items={requests.byCategory.map((r) => ({ label: r.label, value: r.value }))} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Carga da equipe</CardTitle>
              <Definition>
                Carga = soma das estimativas das tarefas abertas com prazo nos próximos 7 dias (inclui atrasadas) ÷
                capacidade semanal. Tarefas sem estimativa não entram na soma e aparecem à parte. É um apoio ao
                planejamento, não uma medida de desempenho.
              </Definition>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <Table>
              <THead>
                <tr>
                  <TH>Pessoa</TH>
                  <TH className="text-right">Abertas</TH>
                  <TH className="text-right">Atrasadas</TH>
                  <TH className="hidden text-right md:table-cell">Sem estimativa</TH>
                  <TH>Carga (7 dias)</TH>
                </tr>
              </THead>
              <TBody>
                {team.map((m) => (
                  <TR key={m.membershipId}>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Avatar name={m.name} src={m.image} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{m.roleName}</span>
                        </span>
                      </span>
                    </TD>
                    <TD className="tabular text-right">{m.open}</TD>
                    <TD className={`tabular text-right ${m.overdue ? "text-danger" : ""}`}>{m.overdue}</TD>
                    <TD className="tabular hidden text-right text-fg-muted md:table-cell">{m.unestimated}</TD>
                    <TD>
                      {m.load === null ? (
                        <span className="text-xs text-fg-subtle">Sem capacidade definida</span>
                      ) : (
                        <Meter
                          ratio={m.load}
                          tone={m.load > 1 ? "danger" : m.load > 0.85 ? "warning" : undefined}
                          label={`${formatPercent(m.load)} · ${formatMinutes(m.upcomingMinutes)} de ${formatMinutes(m.capacity)}`}
                        />
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Projetos por status</CardTitle>
                <Definition>Projetos não arquivados, pelo status atual.</Definition>
              </div>
            </CardHeader>
            <CardContent>
              <BarList items={projects.map((p) => ({ label: p.name, value: Number(p.n) }))} />
            </CardContent>
          </Card>

          {ai ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Uso de IA</CardTitle>
                  <Definition>
                    Tokens (entrada + saída) por mês, nos últimos 6 meses. Custo conforme informado/estimado pelo
                    provedor.
                  </Definition>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4">
                <ColumnChart
                  title="Tokens de IA por mês"
                  height={180}
                  series={[{ key: "tokens", label: "Tokens" }]}
                  data={ai.map((m) => ({ label: formatMonth(`${m.month}-15`), tokens: m.tokens }))}
                />
                <p className="text-xs text-fg-muted">
                  Total em 6 meses: {formatNumber(ai.reduce((a, m) => a + m.requests, 0))} solicitações · US${" "}
                  {ai
                    .reduce((a, m) => a + m.costUsd, 0)
                    .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                  · {ai.reduce((a, m) => a + m.errors, 0)} com erro ou bloqueadas
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
