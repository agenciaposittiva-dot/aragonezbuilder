import { FileSignature } from "lucide-react";
import Link from "next/link";
import { Stat, StatGrid } from "@/components/app/stat";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { BILLING_TYPE_LABEL, SERVICE_STATUS_LABEL } from "@/lib/validators/clients";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listContracts } from "@/server/services/finance";

const TONE = { active: "success", paused: "warning", ended: "neutral" } as const;

export default async function ContractsPage({ params }: PageProps<"/w/[org]/finance/contracts">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const rows = await inOrg(actor, (s) => listContracts(s));
  const active = rows.filter((r) => r.status === "active");
  const mrr = active.filter((r) => r.billingType === "monthly").reduce((acc, r) => acc + r.amountCents, 0);
  const clientsCount = new Set(active.map((r) => r.clientId)).size;

  return (
    <div className="grid grid-cols-1 gap-5">
      <StatGrid className="lg:grid-cols-3">
        <Stat label="Receita recorrente mensal" value={formatMoney(mrr)} hint="Serviços mensais ativos" />
        <Stat label="Contratos ativos" value={active.length} />
        <Stat label="Clientes com contrato" value={clientsCount} />
      </StatGrid>
      <p className="text-sm text-fg-muted">
        Os contratos são os serviços contratados cadastrados em cada cliente. Serviços mensais com dia de faturamento
        geram faturas automaticamente todo mês (uma por competência).
      </p>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title="Nenhum serviço contratado"
            description="Cadastre serviços na página de cada cliente (aba Visão geral → Serviços contratados)."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Serviço</TH>
                <TH>Cliente</TH>
                <TH className="hidden md:table-cell">Cobrança</TH>
                <TH className="hidden lg:table-cell">Vigência</TH>
                <TH className="hidden lg:table-cell">Última fatura</TH>
                <TH>Status</TH>
                <TH className="text-right">Valor</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD>
                    <Link
                      href={`/w/${actor.orgSlug}/clients/${r.clientId}`}
                      className="text-fg-muted hover:text-fg hover:underline"
                    >
                      {r.clientName}
                    </Link>
                  </TD>
                  <TD className="hidden text-fg-muted md:table-cell">
                    {BILLING_TYPE_LABEL[r.billingType]}
                    {r.billingDay ? ` · dia ${r.billingDay}` : ""}
                  </TD>
                  <TD className="hidden text-fg-muted lg:table-cell">
                    {r.startsOn ? formatDate(r.startsOn) : "—"} → {r.endsOn ? formatDate(r.endsOn) : "sem término"}
                  </TD>
                  <TD className="hidden text-fg-muted lg:table-cell">
                    {r.lastInvoiceAt ? formatDate(r.lastInvoiceAt) : "—"}
                  </TD>
                  <TD>
                    <Badge tone={TONE[r.status]}>{SERVICE_STATUS_LABEL[r.status]}</Badge>
                  </TD>
                  <TD className="tabular text-right font-medium">{formatMoney(r.amountCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
