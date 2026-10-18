"use client";

import { AlertTriangle, ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApprovalStatusBadge } from "@/components/approvals/approval-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import type { PreviewData } from "@/lib/preview-data";
import { APPROVAL_STAGE_LABEL } from "@/lib/validators/approvals";
import { requestContentApprovalAction } from "@/server/actions/content-preview";

/**
 * Aprovação a partir da prévia, pelo fluxo existente: cada página exportada
 * é um arquivo com rodadas de revisão interna e do cliente. O envio pede
 * aprovação de todas as páginas de uma vez; as decisões continuam nos
 * arquivos (e no portal do cliente).
 */
export function ApprovalPanel({
  data,
  errors,
  slideLabel,
}: {
  data: PreviewData;
  errors: number;
  slideLabel: (pageId: string | null, designId: string) => string;
}) {
  const ws = useWorkspace();
  const w = `/w/${ws.orgSlug}`;
  const [stage, setStage] = useState<"internal" | "client" | null>(null);
  const outputs = data.outputs;
  const canRequest = data.permissions.requestApproval && !!data.content;
  const pendingInternal = outputs.some((o) => o.internal === "pending");
  const allInternalOk = outputs.length > 0 && outputs.every((o) => o.internal === "approved");
  const canSkipInternal = ws.permissions.includes("approvals.decide_internal" as never);

  return (
    <div className="grid gap-4" data-testid="preview-approvals">
      {data.exports?.stale ? (
        <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> A arte mudou depois da última exportação. No editor,
          use “Enviar para Arquivos” para gerar a nova versão antes de pedir aprovação.
        </p>
      ) : null}
      {!outputs.length ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-fg-muted">
          Nenhuma página exportada ainda. No editor, use “Enviar para Arquivos”: cada página vira um arquivo com versões
          e aprovação.
        </p>
      ) : (
        <ul className="grid gap-2">
          {outputs.map((o) => (
            <li
              key={`${o.fileId}-${o.pageId}`}
              className="grid gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{slideLabel(o.pageId, o.designId)}</span>
                <Link
                  href={`${w}/files/${o.fileId}`}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted hover:text-fg hover:underline"
                >
                  {o.versionNumber ? `v${o.versionNumber}` : "arquivo"} <ExternalLink className="size-3" aria-hidden />
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                <span>{APPROVAL_STAGE_LABEL.internal}:</span>
                {o.internal ? <ApprovalStatusBadge status={o.internal} /> : <Badge tone="outline">Não enviada</Badge>}
                <span className="ml-1">Cliente:</span>
                {o.client ? <ApprovalStatusBadge status={o.client} /> : <Badge tone="outline">Não enviada</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canRequest && outputs.length ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setStage("internal")} disabled={pendingInternal}>
            <Send /> Pedir revisão interna
          </Button>
          {data.client && (allInternalOk || canSkipInternal) ? (
            <Button size="sm" variant="primary" onClick={() => setStage("client")}>
              <Send /> Enviar ao cliente
            </Button>
          ) : null}
        </div>
      ) : null}
      {data.client && outputs.length && !allInternalOk && !canSkipInternal ? (
        <p className="text-xs text-fg-muted">O envio ao cliente libera depois da revisão interna aprovada.</p>
      ) : null}
      <p className="text-xs text-fg-muted">
        Decisões, comentários e histórico ficam em cada arquivo. O cliente vê a prévia no portal quando o arquivo é
        enviado para a aprovação dele.
      </p>
      {stage ? (
        <RequestDialog
          contentId={data.content!.id}
          stage={stage}
          errors={errors}
          pages={outputs.length}
          onClose={() => setStage(null)}
        />
      ) : null}
    </div>
  );
}

function RequestDialog({
  contentId,
  stage,
  errors,
  pages,
  onClose,
}: {
  contentId: string;
  stage: "internal" | "client";
  errors: number;
  pages: number;
  onClose: () => void;
}) {
  const request = useOrgAction(requestContentApprovalAction, {
    success: (r) =>
      `${r.requested} página(s) enviada(s) para ${stage === "client" ? "aprovação do cliente" : "revisão interna"}`,
    onSuccess: (r) => {
      if (r.failures.length) console.warn("[prévia] páginas não enviadas", r.failures);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void request.run({
              contentId,
              stage,
              message: String(f.get("message") ?? "") || null,
              dueDate: String(f.get("dueDate") ?? "") || null,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{stage === "client" ? "Enviar ao cliente" : "Pedir revisão interna"}</DialogTitle>
            <DialogDescription>
              {pages} página(s) exportada(s) entram no pedido. Páginas que já aguardam esta etapa ficam como estão.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            {errors ? (
              <p className="flex gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />A verificação encontrou {errors} erro(s). Você
                pode enviar mesmo assim, mas o ideal é corrigir antes.
              </p>
            ) : null}
            <Field label="Mensagem (opcional)" htmlFor="preview-approval-message">
              <Textarea id="preview-approval-message" name="message" rows={3} maxLength={2000} />
            </Field>
            <Field label="Prazo (opcional)" htmlFor="preview-approval-due">
              <Input id="preview-approval-due" type="date" name="dueDate" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={request.pending}>
              <Send /> Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
