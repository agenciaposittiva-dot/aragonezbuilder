"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { cn } from "@/lib/utils";

type Result<T> =
  { ok: true; data: T } | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

export type DeleteImpact = {
  items: { key: string; label: string; one: string; count: number; effect: "trash" | "kept" | "unlinked" }[];
  finance?: boolean;
};

const EFFECT: Record<DeleteImpact["items"][number]["effect"], string> = {
  trash: "vai para a lixeira junto",
  kept: "continua no cliente",
  unlinked: "continua, sem o vínculo",
};

/**
 * Confirmação de exclusão com o nome do item e o que mais será afetado
 * (carregado do servidor ao abrir). Controlado de fora — abra a partir de um
 * item de menu com `open`/`onOpenChange`, sem aninhar no menu. A mensagem de
 * sucesso só aparece depois que o servidor confirma a exclusão.
 */
type Props<T> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "cliente", "projeto", "arte", "agência" */
  kindLabel: string;
  name: string;
  description?: React.ReactNode;
  loadImpact?: (orgSlug: string) => Promise<Result<DeleteImpact>>;
  onDelete: (orgSlug: string, opts: { confirmFinance: boolean; confirmName: string }) => Promise<Result<T>>;
  typeToConfirm?: boolean;
  financeLabel?: string;
  confirmLabel?: string;
  successMessage: string;
  onDeleted?: (data: T) => void;
  /** Restaura logo após excluir ("Desfazer" na mensagem). */
  onUndo?: (orgSlug: string) => Promise<Result<unknown>>;
};

export function DeleteDialog<T>(props: Props<T>) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onOpenChange={(v) => !busy && props.onOpenChange(v)}>
      <DialogContent size="md">
        {/* O conteúdo só existe com a janela aberta: cada abertura começa do zero. */}
        <DeleteDialogContent {...props} busy={busy} setBusy={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialogContent<T>({
  onOpenChange,
  kindLabel,
  name,
  description,
  loadImpact,
  onDelete,
  typeToConfirm = false,
  financeLabel = "Entendo que as faturas e os contratos deste cliente também vão para a lixeira.",
  confirmLabel = "Mover para a lixeira",
  successMessage,
  onDeleted,
  onUndo,
  busy,
  setBusy,
}: Props<T> & { busy: boolean; setBusy: (v: boolean) => void }) {
  const { orgSlug } = useWorkspace();
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [confirmFinance, setConfirmFinance] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchImpact = useEffectEvent(() => loadImpact?.(orgSlug));
  useEffect(() => {
    let cancelled = false;
    fetchImpact()
      ?.then((res) => {
        if (cancelled) return;
        if (res.ok) setImpact(res.data);
        else setImpactError(res.error);
      })
      .catch(() => !cancelled && setImpactError("Não foi possível verificar o que será afetado."));
    return () => {
      cancelled = true;
    };
  }, []);

  const affected = impact?.items.filter((i) => i.count > 0) ?? [];
  const loading = !!loadImpact && !impact && !impactError;
  const nameOk = !typeToConfirm || confirmName.trim() === name.trim();
  const canConfirm = !loading && !impactError && nameOk && (!impact?.finance || confirmFinance);

  async function confirm() {
    setBusy(true);
    setError(null);
    let res: Result<T>;
    try {
      res = await onDelete(orgSlug, { confirmFinance, confirmName });
    } catch {
      res = { ok: false, error: "Falha de conexão. Nada foi excluído; tente novamente." };
    }
    setBusy(false);
    if (!res.ok) {
      // Nada mudou: a janela continua aberta com o motivo.
      setError(res.error);
      return;
    }
    onOpenChange(false);
    toast.success(successMessage, {
      description: "Fica na lixeira por 30 dias.",
      action: onUndo
        ? {
            label: "Desfazer",
            onClick: async () => {
              const undo = await onUndo(orgSlug).catch(() => null);
              if (undo?.ok) toast.success(`${capitalize(kindLabel)} restaurad${feminine(kindLabel) ? "a" : "o"}`);
              else toast.error(undo && !undo.ok ? undo.error : "Não foi possível desfazer. Use a Lixeira.");
            },
          }
        : undefined,
    });
    onDeleted?.(res.data);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Excluir {kindLabel} “{name}”?
        </DialogTitle>
        <DialogDescription>
          {description ??
            `${capitalize(kindLabel)} vai para a Lixeira e pode ser restaurad${feminine(kindLabel) ? "a" : "o"} por 30 dias. Depois disso, é excluíd${feminine(kindLabel) ? "a" : "o"} definitivamente.`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        {loadImpact ? (
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm" aria-live="polite">
            {loading ? (
              <p className="text-fg-muted">Verificando o que será afetado…</p>
            ) : impactError ? (
              <p role="alert" className="text-danger">
                {impactError}
              </p>
            ) : affected.length ? (
              <>
                <p className="mb-2 font-medium">Conteúdo associado</p>
                <ul className="grid gap-1.5">
                  {affected.map((i) => (
                    <li key={i.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0">
                        <span className="tabular font-semibold">{i.count}</span>{" "}
                        {(i.count === 1 ? i.one : i.label).toLowerCase()}
                      </span>
                      <span className={cn("text-xs", i.effect === "trash" ? "text-warning" : "text-fg-muted")}>
                        {EFFECT[i.effect]}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-fg-muted">Nenhum outro conteúdo é afetado.</p>
            )}
          </div>
        ) : null}
        {impact?.finance ? (
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={confirmFinance}
              onCheckedChange={(v) => setConfirmFinance(v === true)}
              className="mt-0.5"
              aria-label={financeLabel}
            />
            <span>{financeLabel}</span>
          </label>
        ) : null}
        {typeToConfirm ? (
          <Field label={`Para confirmar, digite o nome: ${name}`} htmlFor="delete-confirm-name">
            <Input
              id="delete-confirm-name"
              value={confirmName}
              autoComplete="off"
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </Field>
        ) : null}
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="danger" loading={busy} disabled={!canConfirm} onClick={confirm}>
          <Trash2 /> {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function feminine(kindLabel: string) {
  return ["arte", "agência", "tarefa", "subtarefa"].includes(kindLabel);
}
