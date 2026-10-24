import { CalendarClock, FileSignature } from "lucide-react";
import Link from "next/link";
import { ClearFilters, FilterBar, SelectFilter } from "@/components/app/filters";
import { Stat, StatGrid } from "@/components/app/stat";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { BILLING_TYPE_LABEL, SERVICE_STATUS_LABEL } from "@/lib/validators/clients";
import { CONTRACT_EXPIRING_DAYS, CONTRACT_EXPIRING_OPTIONS } from "@/lib/validators/finance";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listContracts } from "@/server/services/finance";

const TONE = { active: "success", paused: "warning", ended: "neutral" } as const;

/** Rótulo do término para contratos ativos com data de fim. */
function endsLabel(daysLeft: number) {
  if (daysLeft < 0) return `terminou há ${-daysLeft} dia(s)`;
  if (daysLeft === 0) return "termina hoje";
  if (daysLeft === 1) return "termina amanhã";
  return `termina em ${daysLeft} dias`;
}

export default async function ContractsPage({ params, searchParams }: PageProps<"/w/[org]/finance/contracts">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const requested = typeof sp.vencendo === "string" ? Number(sp.vencendo) : NaN;
  const expiring = (CONTRACT_EXPIRING_OPTIONS as readonly number[]).includes(requested) ? requested : null;
  const { all, rows } = await inOrg(actor, async (s) => {
    const all = await listContracts(s);
    return { all, rows: expiring === null ? all : await listContracts(s, { expiringWithin: expiring }) };
  });
  const base = `/w/${actor.orgSlug}/finance/contracts`;
  const active = all.filter((r) => r.status === "active");
  const mrr = active.filter((r) => r.billingType === "monthly").reduce((acc, r) => acc + r.amountCents, 0);
  const clientsCount = new Set(active.map((r) => r.clientId)).size;
  const expiringSoon = active.filter(
    (r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= CONTRACT_EXPIRING_DAYS,
  );
  const expiringCents = expiringSoon.reduce((acc, r) => acc + r.amountCents, 0);

  return (
    <div className="grid grid-cols-1 gap-5">
      <StatGrid>
        <Stat label="Receita recorrente mensal" value={formatMoney(mrr)} hint="Serviços mensais ativos" />
        <Stat label="Contratos ativos" value={active.length} />
        <Stat label="Clientes com contrato" value={clientsCount} />
        <Stat
          label={`A vencer em ${CONTRACT_EXPIRING_DAYS} dias`}
          value={expiringSoon.length}
          tone={expiringSoon.length ? "warning" : undefined}
          hint={expiringSoon.length ? `${formatMoney(expiringCents)} em contratos` : "Nenhum término próximo"}
          href={`${base}?vencendo=${CONTRACT_EXPIRING_DAYS}`}
        />
      </StatGrid>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterBar>
          <SelectFilter
            param="vencendo"
            label="Término"
            options={CONTRACT_EXPIRING_OPTIONS.map((d) => ({ value: String(d), label: `Até ${d} dias` }))}
          />
          <ClearFilters keys={["vencendo"]} />
        </FilterBar>
        <p className="text-sm text-fg-muted">
          Os contratos são os serviços contratados cadastrados em cada cliente. Serviços mensais com dia de faturamento
          geram faturas automaticamente todo mês (uma por competência).
        </p>
      </div>
      <Card>
        {rows.length === 0 ? (
          expiring === null ? (
            <EmptyState
              icon={FileSignature}
              title="Nenhum serviço contratado"
              description="Cadastre serviços na página de cada cliente (aba Visão geral → Serviços contratados)."
            />
          ) : (
            <EmptyState
              icon={CalendarClock}
              title={`Nenhum contrato termina nos próximos ${expiring} dias`}
              description="Só contratos ativos com data de término entram aqui."
            />
          )
        ) : (
          <Table data-testid="contracts-table">
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
              {rows.map((r) => {
                const endsSoon = r.status === "active" && r.daysLeft !== null && r.daysLeft <= CONTRACT_EXPIRING_DAYS;
                return (
                  <TR key={r.id} data-testid="contract-row">
                    <TD className="font-medium">
                      {r.name}
                      {endsSoon ? (
                        <Badge tone={r.daysLeft! < 0 ? "danger" : "warning"} className="ml-2 align-middle lg:hidden">
                          {endsLabel(r.daysLeft!)}
                        </Badge>
                      ) : null}
                    </TD>
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
                      {endsSoon ? (
                        <Badge tone={r.daysLeft! < 0 ? "danger" : "warning"} className="ml-2 align-middle">
                          {endsLabel(r.daysLeft!)}
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="hidden text-fg-muted lg:table-cell">
                      {r.lastInvoiceAt ? formatDate(r.lastInvoiceAt) : "—"}
                    </TD>
                    <TD>
                      <Badge tone={TONE[r.status]}>{SERVICE_STATUS_LABEL[r.status]}</Badge>
                    </TD>
                    <TD className="tabular text-right font-medium">{formatMoney(r.amountCents)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
