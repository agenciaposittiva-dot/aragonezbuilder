"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate, formatMoney } from "@/lib/format";
import { BILLING_TYPE_LABEL, SERVICE_STATUS_LABEL } from "@/lib/validators/clients";
import { deleteServiceAction, saveServiceAction } from "@/server/actions/clients";

type Service = {
  id: string;
  name: string;
  description: string | null;
  billingType: "monthly" | "one_time" | "hourly";
  amountCents: number | null;
  billingDay: number | null;
  startsOn: string | null;
  endsOn: string | null;
  status: "active" | "paused" | "ended";
};

const STATUS_TONE = { active: "success", paused: "warning", ended: "neutral" } as const;

export function ClientServices({
  clientId,
  services,
  canWrite,
  canSeeMoney,
  canEditMoney,
}: {
  clientId: string;
  services: Service[];
  canWrite: boolean;
  canSeeMoney: boolean;
  canEditMoney: boolean;
}) {
  const [editing, setEditing] = useState<Partial<Service> | null>(null);
  const save = useOrgAction(saveServiceAction, { success: "Serviço salvo", onSuccess: () => setEditing(null) });
  const remove = useOrgAction(deleteServiceAction, { success: "Serviço removido" });
  const monthly = services
    .filter((s) => s.status === "active" && s.billingType === "monthly")
    .reduce((acc, s) => acc + (s.amountCents ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Serviços contratados</CardTitle>
          {canSeeMoney && monthly > 0 ? (
            <p className="mt-0.5 text-xs text-fg-muted">Recorrência mensal: {formatMoney(monthly)}</p>
          ) : null}
        </div>
        {canWrite ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditing({ billingType: "monthly", status: "active" })}
          >
            <Plus /> Serviço
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {services.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhum serviço contratado registrado.</p>
        ) : (
          <ul className="grid divide-y divide-border">
            {services.map((sv) => (
              <li key={sv.id} className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{sv.name}</p>
                    <Badge tone={STATUS_TONE[sv.status]}>{SERVICE_STATUS_LABEL[sv.status]}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {BILLING_TYPE_LABEL[sv.billingType]}
                    {sv.startsOn ? ` · desde ${formatDate(sv.startsOn)}` : ""}
                    {sv.endsOn ? ` · até ${formatDate(sv.endsOn)}` : ""}
                    {sv.billingDay ? ` · fatura dia ${sv.billingDay}` : ""}
                  </p>
                  {sv.description ? <p className="mt-1 text-xs text-fg-muted">{sv.description}</p> : null}
                </div>
                {canSeeMoney && sv.amountCents !== null ? (
                  <p className="tabular text-sm font-medium">{formatMoney(sv.amountCents)}</p>
                ) : null}
                {canWrite ? (
                  <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Editar ${sv.name}`}
                      onClick={() => setEditing(sv)}
                    >
                      <Pencil />
                    </Button>
                    <ConfirmDialog
                      title="Remover serviço?"
                      description="Faturas já emitidas para este serviço são mantidas."
                      confirmLabel="Remover"
                      onConfirm={() => remove.run({ clientId, serviceId: sv.id })}
                      trigger={
                        <Button variant="ghost" size="icon-xs" aria-label={`Remover ${sv.name}`}>
                          <Trash2 />
                        </Button>
                      }
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="md">
          {editing ? (
            <form
              className="flex min-h-0 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save.run({
                  id: editing.id ?? null,
                  clientId,
                  name: String(f.get("name") ?? ""),
                  description: String(f.get("description") ?? ""),
                  billingType: String(f.get("billingType")) as Service["billingType"],
                  amount: canEditMoney ? String(f.get("amount") ?? "") : null,
                  billingDay: f.get("billingDay") ? Number(f.get("billingDay")) : null,
                  startsOn: String(f.get("startsOn") ?? ""),
                  endsOn: String(f.get("endsOn") ?? ""),
                  status: String(f.get("status")) as Service["status"],
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>{editing.id ? "Editar serviço" : "Novo serviço contratado"}</DialogTitle>
              </DialogHeader>
              <DialogBody className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Serviço"
                  htmlFor="sv-name"
                  required
                  error={save.fieldErrors.name}
                  className="sm:col-span-2"
                >
                  <Input
                    id="sv-name"
                    name="name"
                    defaultValue={editing.name ?? ""}
                    placeholder="Ex.: Gestão de redes sociais"
                    required
                    autoFocus
                  />
                </Field>
                <Field label="Cobrança" htmlFor="sv-billing">
                  <NativeSelect id="sv-billing" name="billingType" defaultValue={editing.billingType ?? "monthly"}>
                    {Object.entries(BILLING_TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Status" htmlFor="sv-status">
                  <NativeSelect id="sv-status" name="status" defaultValue={editing.status ?? "active"}>
                    {Object.entries(SERVICE_STATUS_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {canEditMoney ? (
                  <Field label="Valor (R$)" htmlFor="sv-amount" error={save.fieldErrors.amount}>
                    <Input
                      id="sv-amount"
                      name="amount"
                      inputMode="decimal"
                      placeholder="0,00"
                      defaultValue={
                        editing.amountCents != null ? (editing.amountCents / 100).toFixed(2).replace(".", ",") : ""
                      }
                    />
                  </Field>
                ) : null}
                <Field label="Dia da fatura" htmlFor="sv-day" hint="Para cobrança mensal (1 a 28).">
                  <Input
                    id="sv-day"
                    name="billingDay"
                    type="number"
                    min={1}
                    max={28}
                    defaultValue={editing.billingDay ?? ""}
                  />
                </Field>
                <Field label="Início" htmlFor="sv-start">
                  <Input id="sv-start" name="startsOn" type="date" defaultValue={editing.startsOn ?? ""} />
                </Field>
                <Field label="Término" htmlFor="sv-end">
                  <Input id="sv-end" name="endsOn" type="date" defaultValue={editing.endsOn ?? ""} />
                </Field>
                <Field label="Descrição / escopo" htmlFor="sv-desc" className="sm:col-span-2">
                  <Textarea id="sv-desc" name="description" rows={2} defaultValue={editing.description ?? ""} />
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={save.pending}>
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
