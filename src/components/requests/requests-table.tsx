import { Inbox } from "lucide-react";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { Pagination } from "@/components/app/pagination";
import { PriorityLabel } from "@/components/app/priority";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { BRIEFING_CATEGORY_LABEL } from "@/lib/validators/briefings";
import type { RequestListRow } from "@/server/services/requests";
import { RequestStatusBadge } from "./request-status";

export function RequestsTable({
  rows,
  total,
  page,
  pageSize,
  basePath,
  detailBase,
  searchParams,
  hideClient,
  hideAssignee,
  emptyAction,
}: {
  rows: RequestListRow[];
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  detailBase: string;
  searchParams: Record<string, string | string[] | undefined>;
  hideClient?: boolean;
  hideAssignee?: boolean;
  emptyAction?: React.ReactNode;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nenhuma solicitação"
        description="Solicitações abertas pelos clientes ou pelo atendimento aparecem aqui, com briefing e anexos."
        action={emptyAction}
      />
    );
  }
  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH className="w-16">Nº</TH>
            <TH>Solicitação</TH>
            <TH>Status</TH>
            <TH className="hidden lg:table-cell">Prioridade</TH>
            {hideAssignee ? null : <TH className="hidden md:table-cell">Responsável</TH>}
            <TH className="hidden sm:table-cell">Prazo desejado</TH>
            <TH className="hidden xl:table-cell">Recebida</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id} className="relative">
              <TD className="tabular text-fg-subtle">#{r.number}</TD>
              <TD className="max-w-[340px]">
                <Link href={`${detailBase}/${r.id}`} className="block after:absolute after:inset-0">
                  <span className="block truncate font-medium">{r.title}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {[hideClient ? null : r.clientName, BRIEFING_CATEGORY_LABEL[r.category]]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </TD>
              <TD>
                <RequestStatusBadge status={r.status} />
              </TD>
              <TD className="hidden lg:table-cell">
                <PriorityLabel priority={r.priority} />
              </TD>
              {hideAssignee ? null : (
                <TD className="hidden md:table-cell">
                  {r.assigneeName ? (
                    <span className="flex items-center gap-2 text-fg-muted">
                      <Avatar name={r.assigneeName} src={r.assigneeImage} size="xs" />
                      <span className="truncate">{r.assigneeName}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-fg-subtle">Sem responsável</span>
                  )}
                </TD>
              )}
              <TD className="hidden sm:table-cell">
                <DueDate date={r.desiredDueDate} done={["delivered", "rejected", "cancelled"].includes(r.status)} />
              </TD>
              <TD className="hidden text-fg-muted xl:table-cell">{formatDate(r.submittedAt ?? r.createdAt)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Pagination page={page} pageSize={pageSize} total={total} searchParams={searchParams} basePath={basePath} />
    </>
  );
}
