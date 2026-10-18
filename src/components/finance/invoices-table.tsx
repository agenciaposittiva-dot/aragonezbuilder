import { Receipt } from "lucide-react";
import Link from "next/link";
import { Pagination } from "@/components/app/pagination";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import type { InvoiceRow } from "@/server/services/finance";
import { InvoiceActions } from "./invoice-actions";
import type { FinanceOptions } from "./invoice-form-dialog";
import { InvoiceStatusBadge } from "./status";

export function InvoicesTable({
  rows,
  total,
  page,
  pageSize,
  searchParams,
  basePath,
  options,
  canWrite,
  orgSlug,
  hideClient,
  emptyAction,
}: {
  rows: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
  options: FinanceOptions;
  canWrite: boolean;
  orgSlug: string;
  hideClient?: boolean;
  emptyAction?: React.ReactNode;
}) {
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhuma fatura encontrada"
          description="Crie uma fatura ou ajuste os filtros."
          action={emptyAction}
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH className="w-16">Nº</TH>
                <TH>Descrição</TH>
                {hideClient ? null : <TH className="hidden md:table-cell">Cliente</TH>}
                <TH className="hidden lg:table-cell">Emissão</TH>
                <TH>Vencimento</TH>
                <TH>Status</TH>
                <TH className="text-right">Valor</TH>
                {canWrite ? <TH className="w-10" /> : null}
              </tr>
            </THead>
            <TBody>
              {rows.map((inv) => (
                <TR key={inv.id}>
                  <TD className="tabular text-fg-muted">#{inv.number}</TD>
                  <TD className="max-w-[280px]">
                    <span className="block truncate font-medium">{inv.description}</span>
                    {inv.projectName ? (
                      <span className="block truncate text-xs text-fg-muted">{inv.projectName}</span>
                    ) : null}
                  </TD>
                  {hideClient ? null : (
                    <TD className="hidden md:table-cell">
                      <Link
                        href={`/w/${orgSlug}/clients/${inv.clientId}/finance`}
                        className="text-fg-muted hover:text-fg hover:underline"
                      >
                        {inv.clientName}
                      </Link>
                    </TD>
                  )}
                  <TD className="hidden text-fg-muted lg:table-cell">{formatDate(inv.issueDate)}</TD>
                  <TD className="text-fg-muted">
                    {formatDate(inv.dueDate)}
                    {inv.status === "paid" && inv.paidAt ? (
                      <span className="block text-xs text-success">Pago em {formatDate(inv.paidAt)}</span>
                    ) : null}
                  </TD>
                  <TD>
                    <InvoiceStatusBadge status={inv.status} />
                  </TD>
                  <TD className="tabular text-right font-medium">{formatMoney(inv.amountCents)}</TD>
                  {canWrite ? (
                    <TD>
                      <InvoiceActions
                        options={options}
                        invoice={{
                          id: inv.id,
                          number: inv.number,
                          status: inv.status,
                          amountCents: inv.amountCents,
                          clientId: inv.clientId,
                          projectId: inv.projectId,
                          clientServiceId: inv.clientServiceId,
                          description: inv.description,
                          issueDate: inv.issueDate,
                          dueDate: inv.dueDate,
                          notes: inv.notes,
                        }}
                      />
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={searchParams} basePath={basePath} />
        </>
      )}
    </Card>
  );
}
