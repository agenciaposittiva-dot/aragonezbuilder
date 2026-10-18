"use client";

import { Check, MessageSquareWarning } from "lucide-react";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { decideApprovalAction } from "@/server/actions/approvals";

/**
 * Botões de decisão de uma aprovação (equipe na revisão interna, cliente na etapa do cliente).
 * Pedir ajustes exige explicar o que mudar.
 */
export function ApprovalDecision({
  approvalId,
  versionNumber,
  size = "sm",
  onDecided,
}: {
  approvalId: string;
  versionNumber?: number;
  size?: "sm" | "md";
  onDecided?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const decide = useOrgAction(decideApprovalAction, {
    success: "Decisão registrada",
    onSuccess: () => {
      setOpen(false);
      setNote("");
      onDecided?.();
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size={size}
        loading={decide.pending && !open}
        onClick={() => decide.run({ approvalId, decision: "approved" })}
      >
        <Check /> Aprovar{versionNumber ? ` v${versionNumber}` : ""}
      </Button>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)} disabled={decide.pending}>
        <MessageSquareWarning /> Solicitar ajustes
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) decide.run({ approvalId, decision: "changes_requested", note });
            }}
          >
            <DialogHeader>
              <DialogTitle>Solicitar ajustes</DialogTitle>
              <DialogDescription>
                Descreva o que precisa mudar. A equipe recebe o pedido e envia uma nova versão.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label="O que ajustar" htmlFor={`note-${approvalId}`} error={decide.fieldErrors.note}>
                <Textarea
                  id={`note-${approvalId}`}
                  rows={5}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex.: trocar a foto principal, aumentar o logotipo e corrigir o preço para R$ 49,90."
                  autoFocus
                  required
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={decide.pending} disabled={!note.trim()}>
                Enviar pedido de ajustes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
