"use client";

import { Ban, CheckCircle2, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgAction } from "@/hooks/use-action";
import { deleteExpenseAction, setExpenseStatusAction } from "@/server/actions/finance";
import { ExpenseFormDialog, type ExpenseFormValues } from "./expense-form-dialog";
import type { FinanceOptions } from "./invoice-form-dialog";

export function ExpenseActions({ expense, options }: { expense: ExpenseFormValues; options: FinanceOptions }) {
  const status = useOrgAction(setExpenseStatusAction, { success: "Despesa atualizada" });
  const remove = useOrgAction(deleteExpenseAction, { success: "Despesa excluída" });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Ações da despesa ${expense.description}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ExpenseFormDialog
          options={options}
          expense={expense}
          trigger={
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <Pencil /> Editar
            </DropdownMenuItem>
          }
        />
        {expense.status === "pending" ? (
          <DropdownMenuItem onSelect={() => status.run({ id: expense.id, status: "paid" })}>
            <CheckCircle2 /> Marcar como paga
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => status.run({ id: expense.id, status: "pending" })}>
            <RotateCcw /> Voltar para a pagar
          </DropdownMenuItem>
        )}
        {expense.status !== "cancelled" ? (
          <DropdownMenuItem onSelect={() => status.run({ id: expense.id, status: "cancelled" })}>
            <Ban /> Cancelar
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <ConfirmDialog
          title="Excluir despesa?"
          description="A exclusão é definitiva. Para manter o histórico, prefira cancelar."
          confirmLabel="Excluir"
          onConfirm={() => remove.run({ id: expense.id })}
          trigger={
            <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
              <Trash2 /> Excluir
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
