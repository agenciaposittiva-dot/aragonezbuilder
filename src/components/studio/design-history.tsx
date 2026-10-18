"use client";

import { GitCompare, History, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
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
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useWorkspace } from "@/components/shell/workspace-context";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  compareDesignVersionsAction,
  createNamedVersionAction,
  listDesignVersionsAction,
  restoreDesignVersionAction,
} from "@/server/actions/designs";
import type { DesignVersionRow } from "@/server/services/design-versions";

const KIND: Record<DesignVersionRow["kind"], { label: string; tone: "neutral" | "accent" | "info" | "warning" }> = {
  auto: { label: "Automática", tone: "neutral" },
  named: { label: "Nomeada", tone: "accent" },
  restore: { label: "Restauração", tone: "info" },
  conflict: { label: "Conflito", tone: "warning" },
};

type Comparison = Extract<Awaited<ReturnType<typeof compareDesignVersionsAction>>, { ok: true }>["data"];

/**
 * Histórico de versões da arte: salvar uma versão com nome, comparar com o
 * estado atual e restaurar (o estado atual vira versão antes — nada se perde).
 */
export function DesignHistory({
  open,
  onOpenChange,
  designId,
  canWrite,
  prepare,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  designId: string;
  canWrite: boolean;
  /** Garante que o servidor tem o estado atual antes de versionar/restaurar. Retorna false se não conseguiu. */
  prepare: () => Promise<boolean>;
  onRestored: (r: { revision: number; document: Record<string, unknown>; versionNumber: number }) => Promise<void>;
}) {
  const { orgSlug } = useWorkspace();
  const [versions, setVersions] = useState<DesignVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<{ id: string; data: Comparison } | null>(null);

  const load = useCallback(async () => {
    const res = await listDesignVersionsAction(orgSlug, { designId }).catch(() => null);
    if (res?.ok) {
      setVersions(res.data);
      setError(null);
    } else setError(res && !res.ok ? res.error : "Não foi possível carregar o histórico.");
  }, [designId, orgSlug]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listDesignVersionsAction(orgSlug, { designId })
      .catch(() => null)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          setVersions(res.data);
          setError(null);
        } else setError(res && !res.ok ? res.error : "Não foi possível carregar o histórico.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, designId, orgSlug]);

  async function saveNamed() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      if (!(await prepare())) return;
      const res = await createNamedVersionAction(orgSlug, { designId, label: label.trim() }).catch(() => null);
      if (res?.ok) {
        toast.success(`Versão ${res.data.versionNumber} “${label.trim()}” salva`);
        setLabel("");
        await load();
      } else toast.error(res && !res.ok ? res.error : "Falha de conexão. A versão não foi salva.");
    } finally {
      setBusy(false);
    }
  }

  async function compare(v: DesignVersionRow) {
    const res = await compareDesignVersionsAction(orgSlug, { fromId: v.id, toId: "current" }).catch(() => null);
    if (res?.ok) setComparison({ id: v.id, data: res.data });
    else toast.error(res && !res.ok ? res.error : "Falha de conexão.");
  }

  async function restore(v: DesignVersionRow) {
    if (!(await prepare())) return;
    const res = await restoreDesignVersionAction(orgSlug, { versionId: v.id }).catch(() => null);
    if (!res?.ok) {
      toast.error(res && !res.ok ? res.error : "Falha de conexão. Nada foi alterado.");
      return;
    }
    await onRestored(res.data);
    toast.success(`Versão ${v.versionNumber} restaurada. O estado anterior ficou guardado no histórico.`);
    setComparison(null);
    await load();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="md" aria-describedby="historico-desc">
        <div className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold">
            <History className="size-4" /> Histórico de versões
          </SheetTitle>
          <SheetDescription id="historico-desc" className="mt-0.5 text-xs text-fg-muted">
            Pontos de controle automáticos a cada intervalo de edição, versões que você nomeia e restaurações. Restaurar
            guarda o estado atual antes.
          </SheetDescription>
        </div>
        {canWrite ? (
          <form
            className="flex gap-2 border-b border-border px-5 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNamed();
            }}
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Nome da versão (ex.: Aprovada pelo cliente)"
              maxLength={80}
              aria-label="Nome da versão"
            />
            <Button type="submit" variant="secondary" loading={busy} disabled={!label.trim()}>
              <Save /> Salvar versão
            </Button>
          </form>
        ) : null}
        <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
          {error ? (
            <p role="alert" className="px-5 py-4 text-sm text-danger">
              {error}
            </p>
          ) : !versions ? (
            <p className="px-5 py-4 text-sm text-fg-muted">Carregando…</p>
          ) : versions.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-muted">
              Ainda não há versões. O primeiro ponto de controle é criado no próximo salvamento.
            </p>
          ) : (
            <ul className="divide-y divide-border" data-testid="design-versions">
              {versions.map((v) => (
                <li key={v.id} className="px-5 py-3">
                  <div className="flex gap-3">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2">
                      {v.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.thumbnail} alt="" className="max-h-full max-w-full object-contain" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        Versão {v.versionNumber}
                        <Badge tone={KIND[v.kind].tone}>{KIND[v.kind].label}</Badge>
                      </p>
                      {v.label ? <p className="truncate text-sm">{v.label}</p> : null}
                      <p className="text-xs text-fg-muted">
                        {formatDateTime(v.createdAt)}
                        {v.createdByName ? ` · ${v.createdByName}` : ""} · {formatBytes(v.sizeBytes)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button size="xs" variant="ghost" onClick={() => void compare(v)}>
                          <GitCompare /> Comparar com a atual
                        </Button>
                        {canWrite ? (
                          <ConfirmDialog
                            title={`Restaurar a versão ${v.versionNumber}?`}
                            description="A arte volta a este estado. O estado atual é guardado como uma nova versão antes, então nada se perde."
                            confirmLabel="Restaurar"
                            tone="primary"
                            onConfirm={() => restore(v)}
                            trigger={
                              <Button size="xs" variant="ghost">
                                <RotateCcw /> Restaurar
                              </Button>
                            }
                          />
                        ) : null}
                      </div>
                      {comparison?.id === v.id ? <ComparisonView data={comparison.data} /> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ComparisonView({ data }: { data: Comparison }) {
  const same = !data.added.length && !data.removed.length && !data.textChanged.length && !data.modified;
  return (
    <div className="mt-2 rounded-md border border-border bg-surface-2 p-2.5 text-xs" aria-live="polite">
      <div className="mb-2 grid grid-cols-2 gap-2">
        {[data.from, data.to].map((side, i) => (
          <figure key={i} className="grid gap-1">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded border border-border bg-surface">
              {side.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={side.thumbnail} alt="" className="max-h-full max-w-full object-contain" />
              ) : null}
            </div>
            <figcaption className="text-fg-muted">
              {i === 0 ? `Versão ${side.versionNumber}` : "Atual"} · {side.objects} elementos · {side.width}×
              {side.height}
            </figcaption>
          </figure>
        ))}
      </div>
      {same ? (
        <p className="text-fg-muted">Sem diferenças de conteúdo.</p>
      ) : (
        <ul className="grid gap-0.5">
          {data.added.map((a, i) => (
            <li key={`a${i}`} className="text-success">
              + {a}
            </li>
          ))}
          {data.removed.map((r, i) => (
            <li key={`r${i}`} className="text-danger">
              − {r}
            </li>
          ))}
          {data.textChanged.map((t, i) => (
            <li key={`t${i}`}>
              Texto: “{t.from.slice(0, 40)}” → “{t.to.slice(0, 40)}”
            </li>
          ))}
          {data.modified ? (
            <li className="text-fg-muted">{data.modified} elemento(s) com posição ou estilo alterado</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/** Conflito de edição: a pessoa escolhe; a outra versão sempre fica no histórico. */
export function DesignConflictDialog({
  open,
  onOpenChange,
  onResolve,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResolve: (strategy: "mine" | "theirs") => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | "mine" | "theirs">(null);
  const run = async (strategy: "mine" | "theirs") => {
    setBusy(strategy);
    try {
      await onResolve(strategy);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Esta arte foi alterada em outra sessão</DialogTitle>
          <DialogDescription>
            Alguém (ou você, em outra aba ou aparelho) salvou esta arte depois que você a abriu. Escolha qual versão
            continua valendo. A outra fica guardada no histórico de versões — nada se perde.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-2 text-sm">
          <p>
            <strong className="font-medium">Manter as minhas alterações:</strong> o que está na sua tela passa a ser a
            versão atual.
          </p>
          <p>
            <strong className="font-medium">Usar a versão salva:</strong> o editor carrega a versão do servidor e suas
            alterações ficam no histórico.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => void run("theirs")} loading={busy === "theirs"} disabled={!!busy}>
            Usar a versão salva
          </Button>
          <Button variant="primary" onClick={() => void run("mine")} loading={busy === "mine"} disabled={!!busy}>
            Manter as minhas alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
