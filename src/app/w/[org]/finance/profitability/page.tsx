import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { DateFilter, FilterBar } from "@/components/app/filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMinutes, formatMoney, formatPercent } from "@/lib/format";
import { profitabilityParams } from "@/lib/validators/finance";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { profitability } from "@/server/services/finance";

export default async function ProfitabilityPage({ params, searchParams }: PageProps<"/w/[org]/finance/profitability">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "costs.read" });
  const parsed = profitabilityParams.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")),
  );
  const filters = parsed.success ? parsed.data : profitabilityParams.parse({});
  const rows = await inOrg(actor, (s) => profitability(s, filters));
  const base = `/w/${actor.orgSlug}/finance/profitability`;
  const qs = (by: string) => {
    const q = new URLSearchParams();
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    if (by !== "project") q.set("by", by);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenueCents,
      labor: acc.labor + r.laborCents,
      expenses: acc.expenses + r.expensesCents,
    }),
    { revenue: 0, labor: 0, expenses: 0 },
  );
  const profit = totals.revenue - totals.labor - totals.expenses;

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterBar>
          <DateFilter param="from" label="De" />
          <DateFilter param="to" label="até" />
        </FilterBar>
        <SegmentedNav
          param="by"
          items={[
            { label: "Por projeto", href: qs("project"), value: "project" },
            { label: "Por cliente", href: qs("client"), value: "client" },
          ]}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Como calculamos</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-fg-muted">
          <p>
            <strong className="font-medium text-fg">Resultado</strong> = faturas (exceto canceladas, pela data de
            emissão) − custo das horas registradas (minutos × custo/hora da pessoa no momento do registro) − despesas
            associadas (exceto canceladas, pela data de vencimento).{" "}
            <strong className="font-medium text-fg">Margem</strong> = resultado ÷ faturado. Por cliente, entram as
            despesas do cliente e dos projetos dele.
          </p>
        </CardContent>
      </Card>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="Sem movimentação no período"
            description="Faturas, horas registradas e despesas aparecem aqui."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{filters.by === "client" ? "Cliente" : "Projeto"}</TH>
                <TH className="text-right">Faturado</TH>
                <TH className="hidden text-right md:table-cell">Horas</TH>
                <TH className="text-right">Custo de horas</TH>
                <TH className="hidden text-right sm:table-cell">Despesas</TH>
                <TH className="text-right">Resultado</TH>
                <TH className="text-right">Margem</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="max-w-[260px]">
                    <Link
                      href={
                        filters.by === "client"
                          ? `/w/${actor.orgSlug}/clients/${r.id}/finance`
                          : `/w/${actor.orgSlug}/projects/${r.id}/finance`
                      }
                      className="block truncate font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.clientName ? <span className="block truncate text-xs text-fg-muted">{r.clientName}</span> : null}
                  </TD>
                  <TD className="tabular text-right">{formatMoney(r.revenueCents)}</TD>
                  <TD className="tabular hidden text-right text-fg-muted md:table-cell">{formatMinutes(r.minutes)}</TD>
                  <TD className="tabular text-right text-fg-muted">{formatMoney(r.laborCents)}</TD>
                  <TD className="tabular hidden text-right text-fg-muted sm:table-cell">
                    {formatMoney(r.expensesCents)}
                  </TD>
                  <TD className={cn("tabular text-right font-medium", r.profitCents < 0 && "text-danger")}>
                    {formatMoney(r.profitCents)}
                  </TD>
                  <TD
                    className={cn(
                      "tabular text-right",
                      r.margin !== null && r.margin < 0 ? "text-danger" : "text-fg-muted",
                    )}
                  >
                    {r.margin === null ? "—" : formatPercent(r.margin, 1)}
                  </TD>
                </TR>
              ))}
              <TR className="bg-surface-2/60 font-medium hover:bg-surface-2/60">
                <TD>Total</TD>
                <TD className="tabular text-right">{formatMoney(totals.revenue)}</TD>
                <TD className="hidden md:table-cell" />
                <TD className="tabular text-right">{formatMoney(totals.labor)}</TD>
                <TD className="tabular hidden text-right sm:table-cell">{formatMoney(totals.expenses)}</TD>
                <TD className={cn("tabular text-right", profit < 0 && "text-danger")}>{formatMoney(profit)}</TD>
                <TD className="tabular text-right">
                  {totals.revenue ? formatPercent(profit / totals.revenue, 1) : "—"}
                </TD>
              </TR>
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
