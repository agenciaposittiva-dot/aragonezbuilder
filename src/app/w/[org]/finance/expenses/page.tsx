import { Plus, Wallet } from "lucide-react";
import { ClearFilters, DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { Stat, StatGrid } from "@/components/app/stat";
import { ExpenseActions } from "@/components/finance/expense-actions";
import { ExpenseFormDialog } from "@/components/finance/expense-form-dialog";
import { ExpenseStatusBadge } from "@/components/finance/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { EXPENSE_CATEGORIES, EXPENSE_STATUS, EXPENSE_STATUS_LABEL, expenseListParams } from "@/lib/validators/finance";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { financeFormOptions, listExpenses } from "@/server/services/finance";

export default async function ExpensesPage({ params, searchParams }: PageProps<"/w/[org]/finance/expenses">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const parsed = expenseListParams.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")),
  );
  const { list, options } = await inOrg(actor, async (s) => ({
    list: await listExpenses(s, parsed.success ? parsed.data : {}),
    options: await financeFormOptions(s),
  }));
  const canWrite = can(actor, "finance.write");
  const newButton = canWrite ? (
    <ExpenseFormDialog
      options={options}
      trigger={
        <Button variant="primary">
          <Plus /> Nova despesa
        </Button>
      }
    />
  ) : null;

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterBar>
          <SearchFilter placeholder="Descrição ou fornecedor" />
          <SelectFilter
            param="status"
            label="Status"
            options={EXPENSE_STATUS.map((st) => ({ value: st, label: EXPENSE_STATUS_LABEL[st] }))}
          />
          <SelectFilter
            param="category"
            label="Categoria"
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <DateFilter param="from" label="Vence de" />
          <DateFilter param="to" label="até" />
          <ClearFilters keys={["q", "status", "category", "from", "to"]} />
        </FilterBar>
        {newButton}
      </div>
      <StatGrid className="lg:grid-cols-2">
        <Stat label="Total filtrado" value={formatMoney(list.sums.totalCents)} hint="Exceto canceladas" />
        <Stat label="A pagar" value={formatMoney(list.sums.pendingCents)} />
      </StatGrid>
      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nenhuma despesa encontrada"
            description="Lance custos de mídia, freelancers, ferramentas e outros."
            action={newButton}
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Descrição</TH>
                  <TH className="hidden md:table-cell">Categoria</TH>
                  <TH className="hidden lg:table-cell">Projeto / cliente</TH>
                  <TH>Vencimento</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Valor</TH>
                  {canWrite ? <TH className="w-10" /> : null}
                </tr>
              </THead>
              <TBody>
                {list.rows.map((e) => (
                  <TR key={e.id}>
                    <TD className="max-w-[260px]">
                      <span className="block truncate font-medium">{e.description}</span>
                      {e.supplier ? <span className="block truncate text-xs text-fg-muted">{e.supplier}</span> : null}
                    </TD>
                    <TD className="hidden text-fg-muted md:table-cell">{e.category}</TD>
                    <TD className="hidden text-fg-muted lg:table-cell">{e.projectName ?? e.clientName ?? "Agência"}</TD>
                    <TD className="text-fg-muted">{formatDate(e.dueDate)}</TD>
                    <TD>
                      <ExpenseStatusBadge status={e.status} />
                    </TD>
                    <TD className="tabular text-right font-medium">{formatMoney(e.amountCents)}</TD>
                    {canWrite ? (
                      <TD>
                        <ExpenseActions
                          options={options}
                          expense={{
                            id: e.id,
                            clientId: e.clientId,
                            projectId: e.projectId,
                            category: e.category,
                            supplier: e.supplier,
                            description: e.description,
                            amountCents: e.amountCents,
                            dueDate: e.dueDate,
                            status: e.status,
                          }}
                        />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              searchParams={sp}
              basePath={`/w/${actor.orgSlug}/finance/expenses`}
            />
          </>
        )}
      </Card>
    </div>
  );
}
