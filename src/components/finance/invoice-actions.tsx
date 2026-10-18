"use client";

import { Ban, CheckCircle2, MoreHorizontal, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { formatMoney, todayISO } from "@/lib/format";
import { PAYMENT_METHODS, type InvoiceStatus } from "@/lib/validators/finance";
import { deleteInvoiceAction, markInvoicePaidAction, transitionInvoiceAction } from "@/server/actions/finance";
import { InvoiceFormDialog, type FinanceOptions, type InvoiceFormValues } from "./invoice-form-dialog";

export function InvoiceActions({
  invoice,
  options,
}: {
  invoice: InvoiceFormValues & { id: string; number: number; status: InvoiceStatus; amountCents: number };
  options: FinanceOptions;
}) {
  const [payOpen, setPayOpen] = useState(false);
  const transition = useOrgAction(transitionInvoiceAction, { success: "Fatura atualizada" });
  const pay = useOrgAction(markInvoicePaidAction, {
    success: "Pagamento registrado",
    onSuccess: () => setPayOpen(false),
  });
  const remove = useOrgAction(deleteInvoiceAction, { success: "Rascunho excluído" });
  const editable = invoice.status === "draft" || invoice.status === "open" || invoice.status === "overdue";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Ações da fatura #${invoice.number}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {editable ? (
            <InvoiceFormDialog
              options={options}
              invoice={invoice}
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Pencil /> Editar
                </DropdownMenuItem>
              }
            />
          ) : null}
          {invoice.status === "draft" ? (
            <DropdownMenuItem onSelect={() => transition.run({ id: invoice.id, action: "issue" })}>
              <Send /> Emitir
            </DropdownMenuItem>
          ) : null}
          {editable ? (
            <DropdownMenuItem onSelect={() => setPayOpen(true)}>
              <CheckCircle2 /> Registrar pagamento
            </DropdownMenuItem>
          ) : null}
          {invoice.status === "paid" ? (
            <DropdownMenuItem onSelect={() => transition.run({ id: invoice.id, action: "reopen" })}>
              <RotateCcw /> Desfazer pagamento
            </DropdownMenuItem>
          ) : null}
          {invoice.status === "cancelled" ? (
            <DropdownMenuItem onSelect={() => transition.run({ id: invoice.id, action: "reopen" })}>
              <RotateCcw /> Reabrir como rascunho
            </DropdownMenuItem>
          ) : null}
          {editable ? (
            <>
              <DropdownMenuSeparator />
              <ConfirmDialog
                title={`Cancelar a fatura #${invoice.number}?`}
                description="A fatura é mantida no histórico como cancelada e deixa de contar nos recebíveis."
                confirmLabel="Cancelar fatura"
                onConfirm={() => transition.run({ id: invoice.id, action: "cancel" })}
                trigger={
                  <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                    <Ban /> Cancelar
                  </DropdownMenuItem>
                }
              />
            </>
          ) : null}
          {invoice.status === "draft" ? (
            <ConfirmDialog
              title={`Excluir o rascunho #${invoice.number}?`}
              confirmLabel="Excluir"
              onConfirm={() => remove.run({ id: invoice.id })}
              trigger={
                <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                  <Trash2 /> Excluir rascunho
                </DropdownMenuItem>
              }
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent size="sm">
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              pay.run({
                id: invoice.id,
                paidAt: String(f.get("paidAt")),
                paymentMethod: String(f.get("method") ?? "") || null,
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Registrar pagamento</DialogTitle>
              <p className="text-sm text-fg-muted">
                Fatura #{invoice.number} · {formatMoney(invoice.amountCents)}
              </p>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <Field label="Data do pagamento" htmlFor="pay-date" required error={pay.fieldErrors.paidAt}>
                <Input id="pay-date" name="paidAt" type="date" defaultValue={todayISO()} max={todayISO()} required />
              </Field>
              <Field label="Forma de pagamento" htmlFor="pay-method">
                <NativeSelect id="pay-method" name="method" defaultValue="PIX">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setPayOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={pay.pending}>
                Confirmar pagamento
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
