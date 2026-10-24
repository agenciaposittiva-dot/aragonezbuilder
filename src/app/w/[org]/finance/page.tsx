import { CalendarClock, CircleDollarSign } from "lucide-react";
import Link from "next/link";
import { ColumnChart } from "@/components/charts/column-chart";
import { Stat, StatGrid } from "@/components/app/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BILLING_TYPE_LABEL } from "@/lib/validators/clients";
import { CONTRACT_EXPIRING_DAYS } from "@/lib/validators/finance";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { delinquentClients, expiringContracts, financeOverview } from "@/server/services/finance";

function endsLabel(daysLeft: number) {
  if (daysLeft === 0) return "hoje";
  if (daysLeft === 1) return "amanhã";
  return `em ${daysLeft} dias`;
}

export default async function FinanceOverviewPage({ params }: PageProps<"/w/[org]/finance">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const { o, delinquent, expiring } = await inOrg(actor, async (s) => ({
    o: await financeOverview(s),
    delinquent: await delinquentClients(s),
    expiring: await expiringContracts(s),
  }));
  const base = `/w/${actor.orgSlug}/finance`;

  return (
    <div className="grid grid-cols-1 gap-6">
      <StatGrid>
        <Stat
          label="Receita recorrente mensal"
          value={formatMoney(o.mrrCents)}
          hint={`${o.activeContracts} contrato(s) mensal(is) ativo(s)`}
          href={`${base}/contracts`}
        />
        <Stat
          label="A receber"
          value={formatMoney(o.openCents)}
          hint={`${o.openCount} fatura(s) em aberto`}
          href={`${base}/invoices?status=open`}
        />
        <Stat
          label="Vencido"
          value={formatMoney(o.overdueCents)}
          tone={o.overdueCents > 0 ? "danger" : undefined}
          hint={`${o.overdueCount} fatura(s)`}
          href={`${base}/invoices?status=overdue`}
        />
        <Stat
          label="Recebido no mês"
          value={formatMoney(o.receivedMonthCents)}
          hint={`Despesas do mês: ${formatMoney(o.expensesMonthCents)}`}
        />
      </StatGrid>
      <StatGrid>
        <Stat
          label="Clientes inadimplentes"
          value={o.delinquentClients}
          tone={o.delinquentClients > 0 ? "danger" : undefined}
          hint="Com ao menos uma fatura vencida"
          href={`${base}/invoices?status=overdue`}
        />
        <Stat
          label={`Contratos a vencer (${CONTRACT_EXPIRING_DAYS} dias)`}
          value={o.expiringContracts}
          tone={o.expiringContracts > 0 ? "warning" : undefined}
          hint={o.expiringContracts > 0 ? `${formatMoney(o.expiringCents)} em contratos` : "Nenhum término próximo"}
          href={`${base}/contracts?vencendo=${CONTRACT_EXPIRING_DAYS}`}
        />
        <Stat
          label="Despesas a pagar"
          value={formatMoney(o.expensesPendingCents)}
          hint="Pendentes, qualquer vencimento"
          href={`${base}/expenses?status=pending`}
        />
        <Stat
          label="Projeção 30 dias"
          value={formatMoney(o.projection[0]?.netCents ?? 0)}
          tone={(o.projection[0]?.netCents ?? 0) < 0 ? "danger" : undefined}
          hint="Entradas previstas − saídas a pagar"
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card data-testid="finance-delinquent">
          <CardHeader>
            <div>
              <CardTitle>Inadimplência por cliente</CardTitle>
              <CardDescription>Faturas vencidas agrupadas por cliente, do maior valor para o menor</CardDescription>
            </div>
          </CardHeader>
          <CardContent className={cn(delinquent.length && "px-0 pb-2")}>
            {delinquent.length === 0 ? (
              <EmptyState compact icon={CircleDollarSign} title="Nenhum cliente com fatura vencida" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Cliente</TH>
                    <TH className="text-right">Faturas</TH>
                    <TH className="text-right">Atraso</TH>
                    <TH className="text-right">Total</TH>
                  </tr>
                </THead>
                <TBody>
                  {delinquent.map((c) => (
                    <TR key={c.clientId}>
                      <TD className="font-medium">
                        <Link
                          href={`${base}/invoices?status=overdue&clientId=${c.clientId}`}
                          className="hover:underline"
                        >
                          {c.clientName}
                        </Link>
                      </TD>
                      <TD className="tabular text-right">{c.count}</TD>
                      <TD className="tabular text-right">
                        <span className={cn(c.daysOverdue >= 30 && "text-danger")}>{c.daysOverdue} dia(s)</span>
                        <span className="block text-xs text-fg-subtle">desde {formatDate(c.oldestDueDate)}</span>
                      </TD>
                      <TD className="tabular text-right font-medium text-danger">{formatMoney(c.totalCents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card data-testid="finance-expiring">
          <CardHeader>
            <div>
              <CardTitle>Contratos a vencer</CardTitle>
              <CardDescription>
                Serviços ativos que terminam nos próximos {CONTRACT_EXPIRING_DAYS} dias · aviso diário à equipe
                financeira
              </CardDescription>
            </div>
            <Link
              href={`${base}/contracts?vencendo=${CONTRACT_EXPIRING_DAYS}`}
              className="text-xs text-fg-muted hover:text-fg"
            >
              Ver contratos
            </Link>
          </CardHeader>
          <CardContent className={cn(expiring.length && "px-0 pb-2")}>
            {expiring.length === 0 ? (
              <EmptyState
                compact
                icon={CalendarClock}
                title={`Nenhum contrato termina nos próximos ${CONTRACT_EXPIRING_DAYS} dias`}
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Serviço</TH>
                    <TH>Término</TH>
                    <TH className="text-right">Valor</TH>
                  </tr>
                </THead>
                <TBody>
                  {expiring.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <span className="block font-medium">{c.name}</span>
                        <Link
                          href={`/w/${actor.orgSlug}/clients/${c.clientId}`}
                          className="text-xs text-fg-muted hover:text-fg hover:underline"
                        >
                          {c.clientName}
                        </Link>
                      </TD>
                      <TD>
                        <Badge tone={c.daysLeft <= 7 ? "danger" : "warning"}>{endsLabel(c.daysLeft)}</Badge>
                        <span className="block text-xs text-fg-subtle">{formatDate(c.endsOn)}</span>
                      </TD>
                      <TD className="tabular text-right">
                        {formatMoney(c.amountCents)}
                        <span className="block text-xs text-fg-subtle">{BILLING_TYPE_LABEL[c.billingType]}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recebido × despesas</CardTitle>
              <CardDescription>
                Últimos 6 meses · recebido pela data de pagamento, despesas pelo vencimento (exceto canceladas)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ColumnChart
              title="Recebido e despesas por mês"
              format="money"
              series={[
                { key: "received", label: "Recebido" },
                { key: "expenses", label: "Despesas" },
              ]}
              data={o.monthly.map((m) => ({
                label: formatMonth(`${m.month}-15`),
                received: m.receivedCents,
                expenses: m.expensesCents,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Projeção de caixa</CardTitle>
              <CardDescription>Faturas em aberto/vencidas × despesas a pagar com vencimento até a data</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <Table>
              <THead>
                <tr>
                  <TH>Próximos</TH>
                  <TH className="text-right">Entradas</TH>
                  <TH className="text-right">Saídas</TH>
                  <TH className="text-right">Saldo</TH>
                </tr>
              </THead>
              <TBody>
                {o.projection.map((p) => (
                  <TR key={p.days}>
                    <TD>{p.days} dias</TD>
                    <TD className="tabular text-right">{formatMoney(p.inflowCents)}</TD>
                    <TD className="tabular text-right text-fg-muted">{formatMoney(p.outflowCents)}</TD>
                    <TD className={cn("tabular text-right font-medium", p.netCents < 0 && "text-danger")}>
                      {formatMoney(p.netCents)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="px-5 pt-3 text-xs text-fg-subtle">
              Não inclui faturas recorrentes ainda não geradas. Despesas a pagar no total:{" "}
              {formatMoney(o.expensesPendingCents)}.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
