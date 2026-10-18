"use client";

import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { FileThumb } from "@/components/files/file-thumb";
import { EmptyState } from "@/components/ui/empty-state";
import { useWorkspace, workspaceBase } from "@/components/shell/workspace-context";
import { formatDateTime } from "@/lib/format";
import { APPROVAL_STAGE_LABEL } from "@/lib/validators/approvals";
import type { ApprovalRow } from "@/server/services/approvals";
import { ApprovalDecision } from "./approval-decision";
import { ApprovalStatusBadge } from "./approval-status";

/** Lista de aprovações com decisão direta na linha (quando o ator pode decidir). */
export function ApprovalList({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: ApprovalRow[];
  emptyTitle: string;
  emptyDescription?: string;
}) {
  const ws = useWorkspace();
  const isClient = ws.kind === "client";
  const base = workspaceBase(ws);
  if (!rows.length) return <EmptyState icon={CheckCheck} title={emptyTitle} description={emptyDescription} />;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const canDecide =
          r.status === "pending" &&
          r.isCurrent &&
          ((r.stage === "internal" && !isClient && ws.permissions.includes("approvals.decide_internal")) ||
            (r.stage === "client" && isClient && ws.permissions.includes("approvals.decide_client")));
        return (
          <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <Link href={`${base}/files/${r.fileId}`} className="flex min-w-0 flex-1 items-center gap-3">
              <FileThumb
                versionId={r.versionId}
                mimeType={r.mimeType}
                name={r.fileName}
                hasThumbnail={r.hasThumbnail}
                className="size-14 shrink-0"
                rounded="rounded-md"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-fg hover:underline">{r.fileName}</span>
                  <span className="tabular text-xs text-fg-subtle">v{r.versionNumber}</span>
                  <ApprovalStatusBadge status={r.status} />
                </span>
                <span className="mt-0.5 block truncate text-xs text-fg-muted">
                  {[isClient ? null : APPROVAL_STAGE_LABEL[r.stage], r.clientName, r.projectName]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                  {r.decidedAt
                    ? `Decidido por ${r.decidedByName ?? "—"} em ${formatDateTime(r.decidedAt)}`
                    : `Pedido por ${r.requestedByName ?? "—"} em ${formatDateTime(r.requestedAt)}`}
                  {r.dueDate && r.status === "pending" ? <DueDate date={r.dueDate} /> : null}
                </span>
                {r.decisionNote ? <span className="mt-1 block text-xs text-fg-muted">“{r.decisionNote}”</span> : null}
              </span>
            </Link>
            {canDecide ? <ApprovalDecision approvalId={r.id} versionNumber={r.versionNumber} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
