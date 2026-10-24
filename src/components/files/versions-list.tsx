import { Download, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDateTime } from "@/lib/format";
import { fileUrl } from "./file-icon";

type Version = {
  id: string;
  versionNumber: number;
  originalName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  note: string | null;
  source: "upload" | "editor" | "ai" | "drive";
  createdAt: Date;
  uploadedByName: string | null;
};

const SOURCE = { upload: "Upload", editor: "Editor", ai: "IA", drive: "Google Drive" } as const;

export function VersionsList({
  versions,
  currentId,
  action,
}: {
  versions: Version[];
  currentId: string | null;
  action?: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <History className="size-4 text-fg-subtle" /> Versões
        </h2>
        {action}
      </div>
      <ol className="grid gap-2">
        {versions.map((v) => (
          <li key={v.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
            <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-xs font-semibold">
              v{v.versionNumber}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">{v.originalName}</p>
                {v.id === currentId ? <Badge tone="accent">Atual</Badge> : null}
                {v.source !== "upload" ? <Badge tone="outline">{SOURCE[v.source]}</Badge> : null}
              </div>
              <p className="mt-0.5 text-xs text-fg-muted">
                {v.uploadedByName ?? "—"} · {formatDateTime(v.createdAt)} · {formatBytes(v.sizeBytes)}
                {v.width && v.height ? ` · ${v.width}×${v.height}` : ""}
              </p>
              {v.note ? <p className="mt-1 text-xs text-fg-muted">“{v.note}”</p> : null}
            </div>
            <a
              href={fileUrl(v.id, { download: true })}
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label={`Baixar versão ${v.versionNumber}`}
              title="Baixar"
            >
              <Download className="size-4" />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
