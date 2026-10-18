"use client";

import { Paperclip, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace, workspaceBase } from "@/components/shell/workspace-context";
import { formatBytes } from "@/lib/format";
import { listAttachmentsAction } from "@/server/actions/files";
import type { FileListRow } from "@/server/services/files";
import { FileThumb } from "./file-thumb";
import { FileStatusBadge } from "./file-status";
import { UploadDialog } from "./upload-dialog";

type Target = { taskId: string } | { projectId: string } | { requestId: string };

/**
 * Anexos de uma tarefa, projeto ou solicitação (lista + envio).
 * Carrega os dados sozinho: basta informar o alvo.
 */
export function FileAttachments({
  target,
  canUpload = true,
  title = "Anexos",
}: {
  target: Target;
  canUpload?: boolean;
  title?: string;
}) {
  const ws = useWorkspace();
  const [rows, setRows] = useState<FileListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const key = JSON.stringify(target);

  const load = useCallback(() => {
    start(async () => {
      const res = await listAttachmentsAction(ws.orgSlug, JSON.parse(key) as Target);
      if (res.ok) {
        setRows(res.data.rows);
        setError(null);
      } else setError(res.error);
    });
  }, [ws.orgSlug, key]);

  useEffect(() => {
    load();
  }, [load]);

  const base = `${workspaceBase(ws)}/files`;

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="size-4 text-fg-subtle" /> {title}
          {rows?.length ? <span className="text-xs font-normal text-fg-subtle">({rows.length})</span> : null}
        </h3>
        {canUpload ? (
          <UploadDialog
            target={target}
            allowCategory={ws.kind === "internal"}
            onUploaded={load}
            trigger={
              <Button variant="secondary" size="xs">
                <Plus /> Anexar
              </Button>
            }
          />
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : rows === null ? (
        <p className="text-sm text-fg-muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhum arquivo anexado.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((f) => (
            <li key={f.id}>
              <Link
                href={`${base}/${f.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-2 transition-colors hover:bg-surface-2"
              >
                <FileThumb
                  versionId={f.versionId}
                  mimeType={f.mimeType}
                  name={f.name}
                  hasThumbnail={f.hasThumbnail}
                  className="size-10 shrink-0"
                  rounded="rounded-md"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  <span className="flex items-center gap-2 text-[11px] text-fg-subtle">
                    v{f.versionNumber ?? 1} · {f.sizeBytes ? formatBytes(f.sizeBytes) : "—"}
                  </span>
                </span>
                {ws.kind === "internal" ? <FileStatusBadge status={f.status} /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
