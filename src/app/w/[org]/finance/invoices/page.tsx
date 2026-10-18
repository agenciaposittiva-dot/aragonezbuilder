import { Plus } from "lucide-react";
import { ClearFilters, DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Stat, StatGrid } from "@/components/app/stat";
import { InvoiceFormDialog } from "@/components/finance/invoice-form-dialog";
import { InvoicesTable } from "@/components/finance/invoices-table";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { INVOICE_STATUS, INVOICE_STATUS_LABEL, invoiceListParams } from "@/lib/validators/finance";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { financeFormOptions, listInvoices } from "@/server/services/finance";

export default async function InvoicesPage({ params, searchParams }: PageProps<"/w/[org]/finance/invoices">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const parsed = invoiceListParams.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")),
  );
  const filters = parsed.success ? parsed.data : {};
  const { list, options } = await inOrg(actor, async (s) => ({
    list: await listInvoices(s, filters),
    options: await financeFormOptions(s),
  }));
  const canWrite = can(actor, "finance.write");
  const basePath = `/w/${actor.orgSlug}/finance/invoices`;
  const newButton = canWrite ? (
    <InvoiceFormDialog
      options={options}
      trigger={
        <Button variant="primary">
          <Plus /> Nova fatura
        </Button>
      }
    />
  ) : null;

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterBar>
          <SearchFilter placeholder="Nº, descrição ou cliente" />
          <SelectFilter
            param="status"
            label="Status"
            options={INVOICE_STATUS.map((st) => ({ value: st, label: INVOICE_STATUS_LABEL[st] }))}
          />
          <SelectFilter
            param="clientId"
            label="Cliente"
            options={options.clients.map((c) => ({ value: c.id, label: c.name }))}
          />
          <DateFilter param="from" label="Vence de" />
          <DateFilter param="to" label="até" />
          <ClearFilters keys={["q", "status", "clientId", "from", "to"]} />
        </FilterBar>
        {newButton}
      </div>
      <StatGrid className="lg:grid-cols-3">
        <Stat label="Total filtrado" value={formatMoney(list.sums.totalCents)} hint="Exceto canceladas" />
        <Stat label="Recebido" value={formatMoney(list.sums.paidCents)} />
        <Stat label="A receber" value={formatMoney(list.sums.pendingCents)} hint="Em aberto e vencidas" />
      </StatGrid>
      <InvoicesTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        searchParams={sp}
        basePath={basePath}
        options={options}
        canWrite={canWrite}
        orgSlug={actor.orgSlug}
        emptyAction={newButton}
      />
    </div>
  );
}
