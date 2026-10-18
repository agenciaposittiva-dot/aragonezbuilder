"use client";

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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { todayISO } from "@/lib/format";
import { createInvoiceAction, updateInvoiceAction } from "@/server/actions/finance";

export type FinanceOptions = {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string }[];
  services: { id: string; name: string; clientId: string; amountCents: number }[];
};

export type InvoiceFormValues = {
  id?: string;
  clientId: string;
  projectId: string | null;
  clientServiceId: string | null;
  description: string;
  amountCents: number | null;
  issueDate: string;
  dueDate: string;
  notes: string | null;
};

const centsToInput = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoiceFormDialog({
  trigger,
  options,
  invoice,
  defaultClientId,
}: {
  trigger: React.ReactNode;
  options: FinanceOptions;
  invoice?: InvoiceFormValues;
  defaultClientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const [clientId, setClientId] = useState(invoice?.clientId ?? defaultClientId ?? "");
  const [serviceId, setServiceId] = useState(invoice?.clientServiceId ?? "");
  const [amount, setAmount] = useState(centsToInput(invoice?.amountCents));
  const [description, setDescription] = useState(invoice?.description ?? "");
  const create = useOrgAction(createInvoiceAction, {
    success: (d) => `Fatura #${d.number} criada`,
    onSuccess: () => setOpen(false),
  });
  const update = useOrgAction(updateInvoiceAction, { success: "Fatura atualizada", onSuccess: () => setOpen(false) });
  const fe = invoice ? update.fieldErrors : create.fieldErrors;
  const projects = options.projects.filter((p) => p.clientId === clientId);
  const services = options.services.filter((s) => s.clientId === clientId);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !invoice) {
          setClientId(defaultClientId ?? "");
          setServiceId("");
          setAmount("");
          setDescription("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const base = {
              clientId,
              projectId: String(f.get("projectId") ?? ""),
              clientServiceId: serviceId,
              description,
              amount,
              issueDate: String(f.get("issueDate") ?? ""),
              dueDate: String(f.get("dueDate") ?? ""),
              notes: String(f.get("notes") ?? ""),
            };
            if (invoice?.id) update.run({ ...base, id: invoice.id });
            else create.run({ ...base, status: f.get("status") === "draft" ? "draft" : "open" });
          }}
        >
          <DialogHeader>
            <DialogTitle>{invoice ? "Editar fatura" : "Nova fatura"}</DialogTitle>
            <DialogDescription>Conta a receber do cliente. O número é gerado automaticamente.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Cliente" htmlFor="inv-client" required error={fe.clientId}>
              <NativeSelect
                id="inv-client"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setServiceId("");
                }}
                required
              >
                <option value="">Selecione…</option>
                {options.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Projeto"
              htmlFor="inv-project"
              hint="Opcional: entra na rentabilidade do projeto."
              error={fe.projectId}
            >
              <NativeSelect
                id="inv-project"
                name="projectId"
                defaultValue={invoice?.projectId ?? ""}
                disabled={!clientId}
                key={`p-${clientId}`}
              >
                <option value="">Sem projeto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Serviço contratado" htmlFor="inv-service" error={fe.clientServiceId}>
              <NativeSelect
                id="inv-service"
                value={serviceId}
                disabled={!clientId}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  const svc = services.find((s) => s.id === e.target.value);
                  if (svc) {
                    if (!amount) setAmount(centsToInput(svc.amountCents));
                    if (!description) setDescription(svc.name);
                  }
                }}
              >
                <option value="">Nenhum</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Valor (R$)" htmlFor="inv-amount" required error={fe.amount}>
              <Input
                id="inv-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="Descrição" htmlFor="inv-desc" required error={fe.description} className="sm:col-span-2">
              <Input
                id="inv-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Gestão de redes · 11/2026"
                required
              />
            </Field>
            <Field label="Emissão" htmlFor="inv-issue" required error={fe.issueDate}>
              <Input id="inv-issue" name="issueDate" type="date" defaultValue={invoice?.issueDate ?? today} required />
            </Field>
            <Field label="Vencimento" htmlFor="inv-due" required error={fe.dueDate}>
              <Input
                id="inv-due"
                name="dueDate"
                type="date"
                defaultValue={invoice?.dueDate ?? plusDays(today, 7)}
                required
              />
            </Field>
            {!invoice ? (
              <Field label="Situação" htmlFor="inv-status">
                <NativeSelect id="inv-status" name="status" defaultValue="open">
                  <option value="open">Emitir agora (em aberto)</option>
                  <option value="draft">Salvar como rascunho</option>
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="Observações" htmlFor="inv-notes" className="sm:col-span-2">
              <Textarea id="inv-notes" name="notes" rows={2} defaultValue={invoice?.notes ?? ""} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={create.pending || update.pending}>
              {invoice ? "Salvar" : "Criar fatura"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
