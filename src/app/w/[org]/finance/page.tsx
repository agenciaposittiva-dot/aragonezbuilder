import { ColumnChart } from "@/components/charts/column-chart";
import { Stat, StatGrid } from "@/components/app/stat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { financeOverview } from "@/server/services/finance";

export default async function FinanceOverviewPage({ params }: PageProps<"/w/[org]/finance">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const o = await inOrg(actor, (s) => financeOverview(s));
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
