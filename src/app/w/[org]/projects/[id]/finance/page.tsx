import { Stat, StatGrid } from "@/components/app/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes, formatMoney, formatPercent } from "@/lib/format";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { projectFinancials } from "@/server/services/projects";

export default async function ProjectFinancePage({ params }: PageProps<"/w/[org]/projects/[id]/finance">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "costs.read" });
  const f = await inOrg(actor, (s) => projectFinancials(s, id));
  const budgetUse = f.budgetCents ? (f.laborCostCents + f.expensesCents) / f.budgetCents : null;
  return (
    <div className="grid gap-6">
      <StatGrid>
        <Stat label="Faturado" value={formatMoney(f.invoicedCents)} hint={`${formatMoney(f.receivedCents)} recebido`} />
        <Stat
          label="Custo de horas"
          value={formatMoney(f.laborCostCents)}
          hint={`${formatMinutes(f.minutes)} registradas`}
        />
        <Stat label="Despesas diretas" value={formatMoney(f.expensesCents)} />
        <Stat
          label="Resultado"
          value={formatMoney(f.profitCents)}
          tone={f.profitCents < 0 ? "danger" : f.profitCents > 0 ? "success" : undefined}
          hint={f.margin !== null ? `Margem ${formatPercent(f.margin, 1)}` : "Sem faturamento ainda"}
        />
      </StatGrid>
      <Card>
        <CardHeader>
          <CardTitle>Como o resultado é calculado</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-fg-muted">
          <p>
            Resultado = faturas do projeto (exceto canceladas) − custo das horas registradas nas tarefas (minutos ×
            custo/hora de cada pessoa no momento do registro) − despesas associadas ao projeto.
          </p>
          {f.budgetCents ? (
            <p>
              Orçamento: {formatMoney(f.budgetCents)}. Consumido: {formatPercent(budgetUse ?? 0, 0)} (horas + despesas).
            </p>
          ) : (
            <p>Defina um orçamento no projeto para acompanhar o consumo.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
