"use client";

import { CheckCheck, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate, formatDateTime } from "@/lib/format";
import { APPROVAL_STAGE_LABEL } from "@/lib/validators/approvals";
import { cancelApprovalAction } from "@/server/actions/approvals";
import type { ApprovalRow } from "@/server/services/approvals";
import { ApprovalDecision } from "./approval-decision";
import { ApprovalStatusBadge } from "./approval-status";
import { RequestApprovalDialog } from "./request-approval-dialog";

/** Rodadas de aprovação de um arquivo, agrupadas por versão. */
export function ApprovalsPanel({
  fileId,
  rounds,
  currentVersion,
  hasClient,
}: {
  fileId: string;
  rounds: ApprovalRow[];
  currentVersion: { id: string; versionNumber: number } | null;
  hasClient: boolean;
}) {
  const ws = useWorkspace();
  const can = (p: string) => ws.permissions.includes(p as never);
  const isClient = ws.kind === "client";
  const cancel = useOrgAction(cancelApprovalAction, { success: "Pedido cancelado" });
  const currentRounds = rounds.filter((r) => r.versionId === currentVersion?.id);
  const pendingInternal = currentRounds.find((r) => r.stage === "internal" && r.status === "pending");
  const pendingClient = currentRounds.find((r) => r.stage === "client" && r.status === "pending");
  const internalApproved = currentRounds.some((r) => r.stage === "internal" && r.status === "approved");
  const clientApproved = currentRounds.some((r) => r.stage === "client" && r.status === "approved");

  const groups = new Map<number, ApprovalRow[]>();
  for (const r of rounds) groups.set(r.versionNumber, [...(groups.get(r.versionNumber) ?? []), r]);

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <CheckCheck className="size-4 text-fg-subtle" /> Aprovações
        </h2>
        {!isClient && currentVersion && can("approvals.request") ? (
          <div className="flex flex-wrap gap-2">
            {!pendingInternal && !internalApproved ? (
              <RequestApprovalDialog fileId={fileId} versionNumber={currentVersion.versionNumber} stage="internal" />
            ) : null}
            {hasClient &&
            !pendingClient &&
            !clientApproved &&
            (internalApproved || can("approvals.decide_internal")) ? (
              <RequestApprovalDialog fileId={fileId} versionNumber={currentVersion.versionNumber} stage="client" />
            ) : null}
          </div>
        ) : null}
      </div>

      {rounds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-fg-muted">
          {isClient
            ? "Nenhuma aprovação pedida para este arquivo."
            : "Nenhuma rodada de aprovação. Peça a revisão interna da versão atual."}
        </p>
      ) : (
        <div className="grid gap-4">
          {[...groups.entries()].map(([versionNumber, list]) => (
            <div key={versionNumber} className="grid gap-2">
              <p className="text-xs font-medium text-fg-subtle">
                Versão {versionNumber}
                {list[0]?.isCurrent ? " · atual" : ""}
              </p>
              <ul className="grid gap-2">
                {list.map((r) => {
                  const canDecide =
                    r.status === "pending" &&
                    r.isCurrent &&
                    ((r.stage === "internal" && !isClient && can("approvals.decide_internal")) ||
                      (r.stage === "client" && isClient && can("approvals.decide_client")));
                  const canCancel =
                    r.status === "pending" &&
                    !isClient &&
                    (r.requestedByUserId === ws.userId || can("approvals.decide_internal"));
                  return (
                    <li key={r.id} className="grid gap-2 rounded-lg border border-border bg-surface p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{APPROVAL_STAGE_LABEL[r.stage]}</span>
                          <ApprovalStatusBadge status={r.status} />
                        </div>
                        {canCancel ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => cancel.run({ approvalId: r.id })}
                            disabled={cancel.pending}
                          >
                            <X /> Cancelar pedido
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-xs text-fg-muted">
                        Pedido por {r.requestedByName ?? "—"} em {formatDateTime(r.requestedAt)}
                        {r.dueDate ? ` · prazo ${formatDate(r.dueDate)}` : ""}
                      </p>
                      {r.message ? (
                        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap">{r.message}</p>
                      ) : null}
                      {r.decidedAt ? (
                        <div className="flex items-start gap-2">
                          <Avatar name={r.decidedByName ?? "?"} size="xs" className="mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-xs text-fg-muted">
                              {r.decidedByName ?? "—"} · {formatDateTime(r.decidedAt)}
                            </p>
                            {r.decisionNote ? (
                              <p className="mt-0.5 text-sm whitespace-pre-wrap">{r.decisionNote}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {canDecide ? <ApprovalDecision approvalId={r.id} versionNumber={r.versionNumber} /> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
