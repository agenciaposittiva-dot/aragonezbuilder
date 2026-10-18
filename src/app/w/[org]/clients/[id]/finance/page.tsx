import { Plus } from "lucide-react";
import { Stat, StatGrid } from "@/components/app/stat";
import { InvoiceFormDialog } from "@/components/finance/invoice-form-dialog";
import { InvoicesTable } from "@/components/finance/invoices-table";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { invoiceListParams } from "@/lib/validators/finance";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientFinance, financeFormOptions, listInvoices } from "@/server/services/finance";

export default async function ClientFinancePage({ params, searchParams }: PageProps<"/w/[org]/clients/[id]/finance">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const parsed = invoiceListParams.safeParse({ page: typeof sp.page === "string" ? sp.page : undefined });
  const { totals, list, options } = await inOrg(actor, async (s) => ({
    totals: await clientFinance(s, id),
    list: await listInvoices(s, parsed.success ? parsed.data : {}, id),
    options: await financeFormOptions(s),
  }));
  const canWrite = can(actor, "finance.write");

  return (
    <div className="grid grid-cols-1 gap-5">
      <StatGrid>
        <Stat label="Recorrência mensal" value={formatMoney(totals.mrrCents)} />
        <Stat label="A receber" value={formatMoney(totals.openCents)} />
        <Stat
          label="Vencido"
          value={formatMoney(totals.overdueCents)}
          tone={totals.overdueCents > 0 ? "danger" : undefined}
        />
        <Stat label="Recebido no ano" value={formatMoney(totals.paidYearCents)} />
      </StatGrid>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Faturas</h2>
        {canWrite ? (
          <InvoiceFormDialog
            options={options}
            defaultClientId={id}
            trigger={
              <Button variant="primary" size="sm">
                <Plus /> Nova fatura
              </Button>
            }
          />
        ) : null}
      </div>
      <InvoicesTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        searchParams={sp}
        basePath={`/w/${actor.orgSlug}/clients/${id}/finance`}
        options={options}
        canWrite={canWrite}
        orgSlug={actor.orgSlug}
        hideClient
      />
    </div>
  );
}
