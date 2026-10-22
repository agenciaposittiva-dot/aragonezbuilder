"use client";

import { AlertTriangle, CheckCircle2, CloudOff, GitCompare, Loader2, RotateCw } from "lucide-react";
import type { AutosaveState } from "@/lib/autosave/controller";
import { cn } from "@/lib/utils";

const LABEL: Record<AutosaveState["status"], string> = {
  saved: "Todas as alterações salvas",
  dirty: "Salvando alterações...",
  saving: "Salvando alterações...",
  offline: "Sem conexão — alterações pendentes",
  error: "Erro ao salvar — tentar novamente",
  conflict: "Conflito de edição — revisar alterações",
};

function time(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Estado real do salvamento automático, discreto. "Erro" e "conflito" viram
 * botões (tentar de novo / revisar).
 */
export function SaveIndicator({
  state,
  onRetry,
  onReview,
  className,
  compact = false,
}: {
  state: AutosaveState;
  onRetry?: () => void;
  onReview?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const { status } = state;
  const icon =
    status === "saved" ? (
      <CheckCircle2 className="size-3.5 text-success" />
    ) : status === "offline" ? (
      <CloudOff className="size-3.5 text-warning" />
    ) : status === "error" ? (
      <AlertTriangle className="size-3.5 text-danger" />
    ) : status === "conflict" ? (
      <GitCompare className="size-3.5 text-danger" />
    ) : (
      <Loader2 className="size-3.5 animate-spin text-fg-subtle" />
    );
  const title =
    status === "saved" && state.lastSavedAt
      ? `Salvo no servidor às ${time(state.lastSavedAt)}`
      : (state.message ?? LABEL[status]);
  const label = LABEL[status];
  const content = (
    <>
      {icon}
      {/* `not-sr-only` volta a `white-space: normal`; o nowrap precisa vir junto para não quebrar em 3 linhas. */}
      <span className={cn(compact && "sr-only xl:not-sr-only xl:whitespace-nowrap")}>{label}</span>
      {status === "error" && onRetry ? <RotateCw className="size-3" /> : null}
    </>
  );
  const base = cn(
    "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap",
    status === "error" || status === "conflict"
      ? "text-danger"
      : status === "offline"
        ? "text-warning"
        : "text-fg-muted",
    className,
  );
  if (status === "error" && onRetry) {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={title}
        className={cn(base, "hover:bg-danger-soft")}
        data-save-state={status}
      >
        {content}
      </button>
    );
  }
  if (status === "conflict" && onReview) {
    return (
      <button
        type="button"
        onClick={onReview}
        title={title}
        className={cn(base, "hover:bg-danger-soft")}
        data-save-state={status}
      >
        {content}
      </button>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      title={title}
      className={base}
      data-save-state={status}
      // Momento da última confirmação do servidor (vazio enquanto nada foi salvo nesta sessão).
      data-saved-at={state.lastSavedAt ?? ""}
    >
      {content}
    </span>
  );
}
