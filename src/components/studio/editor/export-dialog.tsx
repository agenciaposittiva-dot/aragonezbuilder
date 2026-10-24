"use client";

import { Cloud, Download, Send } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { ExportFormat, ExportOptions } from "./export";
import { useEditor, type EditorStore } from "./store";

/** Opções de exportação: formato, páginas e resolução. */
export function ExportDialog({
  open,
  onOpenChange,
  store,
  canSend,
  driveConnected = false,
  busy,
  onDownload,
  onSend,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  store: EditorStore;
  canSend: boolean;
  /** A pessoa tem o Google Drive conectado: oferece enviar também para lá. */
  driveConnected?: boolean;
  busy: "download" | "send" | "drive" | null;
  onDownload: (o: ExportOptions) => void;
  onSend: (o: ExportOptions, destination?: "files" | "drive") => void;
}) {
  const doc = useEditor(store, (s) => s.doc);
  const active = useEditor(store, (s) => s.activePageId);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scope, setScope] = useState<"current" | "all" | "pick">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(0.92);
  const multi = doc.pages.length > 1;
  const pageIds =
    scope === "current"
      ? [active]
      : scope === "all"
        ? doc.pages.map((p) => p.id)
        : doc.pages.filter((p) => picked.includes(p.id)).map((p) => p.id);
  const first = doc.pages[0]!;
  const opts: ExportOptions = { format, pageIds, scale, quality };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Exportar arte</DialogTitle>
          <DialogDescription>
            PNG e JPEG geram um arquivo por página; o PDF reúne todas as páginas escolhidas num arquivo só.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-xs font-medium text-fg-muted">Formato</legend>
            <div className="flex gap-1.5">
              {(
                [
                  ["png", "PNG", "Melhor qualidade, aceita transparência"],
                  ["jpeg", "JPEG", "Arquivo menor, fundo branco"],
                  ["pdf", "PDF", "Várias páginas num arquivo"],
                ] as const
              ).map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={format === k}
                  onClick={() => setFormat(k)}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-2 text-left",
                    format === k ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                  )}
                >
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-[11px] text-fg-muted">{hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {multi ? (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-xs font-medium text-fg-muted">Páginas</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {(
                  [
                    ["all", `Todas (${doc.pages.length})`],
                    ["current", "Página atual"],
                    ["pick", "Escolher"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="radio" name="export-scope" checked={scope === k} onChange={() => setScope(k)} />
                    {label}
                  </label>
                ))}
              </div>
              {scope === "pick" ? (
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-border p-2">
                  {doc.pages.map((p, i) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.includes(p.id)}
                        onChange={(e) =>
                          setPicked((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))
                        }
                      />
                      {i + 1}. {p.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-fg-muted">
              Resolução
              <select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg"
              >
                {[1, 2, 3].map((s) => (
                  <option key={s} value={s}>
                    {s}× — {first.width * s}×{first.height * s}px
                  </option>
                ))}
              </select>
            </label>
            {format !== "png" ? (
              <label className="grid gap-1 text-xs font-medium text-fg-muted">
                Qualidade {Math.round(quality * 100)}%
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="accent-[var(--accent)]"
                />
              </label>
            ) : null}
          </div>
          <p className="text-xs text-fg-muted">
            Em Arquivos, cada página exportada vira um arquivo da arte; exportar de novo cria uma nova versão do mesmo
            arquivo, pronta para enviar ao cliente para aprovação.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onDownload(opts)}
            loading={busy === "download"}
            disabled={!pageIds.length || !!busy}
          >
            <Download /> Baixar
          </Button>
          {canSend && driveConnected ? (
            <Button
              variant="secondary"
              onClick={() => onSend(opts, "drive")}
              loading={busy === "drive"}
              disabled={!pageIds.length || !!busy}
              data-testid="export-drive"
            >
              <Cloud /> Enviar para Arquivos e Google Drive
            </Button>
          ) : null}
          {canSend ? (
            <Button
              variant="primary"
              onClick={() => onSend(opts)}
              loading={busy === "send"}
              disabled={!pageIds.length || !!busy}
            >
              <Send /> Enviar para Arquivos
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
