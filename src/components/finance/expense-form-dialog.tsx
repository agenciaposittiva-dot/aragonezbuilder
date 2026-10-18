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
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { todayISO } from "@/lib/format";
import { EXPENSE_CATEGORIES, EXPENSE_STATUS_LABEL, type ExpenseStatus } from "@/lib/validators/finance";
import { saveExpenseAction } from "@/server/actions/finance";
import type { FinanceOptions } from "./invoice-form-dialog";

export type ExpenseFormValues = {
  id: string;
  clientId: string | null;
  projectId: string | null;
  category: string;
  supplier: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  status: ExpenseStatus;
};

export function ExpenseFormDialog({
  trigger,
  options,
  expense,
}: {
  trigger: React.ReactNode;
  options: FinanceOptions;
  expense?: ExpenseFormValues;
}) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(expense?.clientId ?? "");
  const save = useOrgAction(saveExpenseAction, { success: "Despesa salva", onSuccess: () => setOpen(false) });
  const fe = save.fieldErrors;
  const projects = clientId ? options.projects.filter((p) => p.clientId === clientId) : options.projects;
  const categories =
    expense && !EXPENSE_CATEGORIES.includes(expense.category)
      ? [expense.category, ...EXPENSE_CATEGORIES]
      : EXPENSE_CATEGORIES;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.run({
              id: expense?.id ?? null,
              clientId,
              projectId: String(f.get("projectId") ?? ""),
              category: String(f.get("category") ?? ""),
              supplier: String(f.get("supplier") ?? ""),
              description: String(f.get("description") ?? ""),
              amount: String(f.get("amount") ?? ""),
              dueDate: String(f.get("dueDate") ?? ""),
              status: String(f.get("status")) as ExpenseStatus,
              paidAt: String(f.get("dueDate") ?? ""),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{expense ? "Editar despesa" : "Nova despesa"}</DialogTitle>
            <DialogDescription>
              Conta a pagar. Associe a um projeto para que ela entre na rentabilidade.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Descrição" htmlFor="exp-desc" required error={fe.description} className="sm:col-span-2">
              <Input id="exp-desc" name="description" defaultValue={expense?.description ?? ""} required autoFocus />
            </Field>
            <Field label="Categoria" htmlFor="exp-cat" required error={fe.category}>
              <NativeSelect id="exp-cat" name="category" defaultValue={expense?.category ?? EXPENSE_CATEGORIES[0]}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Fornecedor" htmlFor="exp-supplier">
              <Input id="exp-supplier" name="supplier" defaultValue={expense?.supplier ?? ""} />
            </Field>
            <Field label="Valor (R$)" htmlFor="exp-amount" required error={fe.amount}>
              <Input
                id="exp-amount"
                name="amount"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={expense ? (expense.amountCents / 100).toFixed(2).replace(".", ",") : ""}
                required
              />
            </Field>
            <Field label="Vencimento" htmlFor="exp-due" required error={fe.dueDate}>
              <Input id="exp-due" name="dueDate" type="date" defaultValue={expense?.dueDate ?? todayISO()} required />
            </Field>
            <Field label="Cliente" htmlFor="exp-client" hint="Opcional.">
              <NativeSelect id="exp-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Despesa da agência</option>
                {options.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Projeto" htmlFor="exp-project" error={fe.projectId}>
              <NativeSelect
                id="exp-project"
                name="projectId"
                defaultValue={expense?.projectId ?? ""}
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
            <Field label="Situação" htmlFor="exp-status">
              <NativeSelect id="exp-status" name="status" defaultValue={expense?.status ?? "pending"}>
                {(["pending", "paid", "cancelled"] as const).map((st) => (
                  <option key={st} value={st}>
                    {EXPENSE_STATUS_LABEL[st]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={save.pending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
