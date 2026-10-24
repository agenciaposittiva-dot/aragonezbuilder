"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A IA estimou um custo acima do limite da organização: a pessoa decide. */
export function CostPrompt({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm"
    >
      <AlertTriangle className="size-4 text-warning" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button size="sm" variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>
      <Button size="sm" variant="primary" onClick={onConfirm}>
        Confirmar e continuar
      </Button>
    </div>
  );
}
