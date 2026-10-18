"use client";

import { Share2 } from "lucide-react";
import Link from "next/link";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useWorkspace, workspaceBase } from "@/components/shell/workspace-context";
import { formatBytes, formatDate } from "@/lib/format";
import { FILE_CATEGORY_LABEL, type FileCategory, type FileStatus } from "@/lib/validators/files";
import { FavoriteButton } from "./favorite-button";
import { FileThumb } from "./file-thumb";
import { FileStatusBadge } from "./file-status";

export type FileCardData = {
  id: string;
  name: string;
  category: FileCategory;
  status: FileStatus;
  sharedWithClient: boolean;
  clientName: string | null;
  projectName: string | null;
  updatedAt: Date;
  versionId: string | null;
  versionNumber: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
  hasThumbnail: boolean;
  favorite: boolean;
};

/** Grade ou lista de arquivos. `basePath` define para onde o clique leva. */
export function FileCollection({
  files,
  view,
  basePath,
}: {
  files: FileCardData[];
  view: "grid" | "list";
  basePath?: string;
}) {
  const ws = useWorkspace();
  const base = basePath ?? `${workspaceBase(ws)}/files`;
  const internal = ws.kind === "internal";

  if (view === "list") {
    return (
      <Table>
        <THead>
          <tr>
            <TH>Arquivo</TH>
            <TH className="hidden md:table-cell">Cliente / projeto</TH>
            <TH>Status</TH>
            <TH className="hidden sm:table-cell">Versão</TH>
            <TH className="hidden lg:table-cell">Tamanho</TH>
            <TH className="hidden lg:table-cell">Atualizado</TH>
            <TH className="w-10">
              <span className="sr-only">Favorito</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {files.map((f) => (
            <TR key={f.id} className="relative">
              <TD className="max-w-[320px]">
                <Link href={`${base}/${f.id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                  <FileThumb
                    versionId={f.versionId}
                    mimeType={f.mimeType}
                    name={f.name}
                    hasThumbnail={f.hasThumbnail}
                    className="size-10 shrink-0"
                    rounded="rounded-md"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-fg-muted">{FILE_CATEGORY_LABEL[f.category]}</span>
                  </span>
                </Link>
              </TD>
              <TD className="hidden max-w-[220px] md:table-cell">
                <span className="block truncate text-fg-muted">{f.clientName ?? "Interno"}</span>
                {f.projectName ? <span className="block truncate text-xs text-fg-subtle">{f.projectName}</span> : null}
              </TD>
              <TD>
                <div className="flex items-center gap-1.5">
                  <FileStatusBadge status={f.status} />
                  {internal && f.sharedWithClient ? (
                    <Share2 className="size-3.5 text-fg-subtle" aria-label="Compartilhado com o cliente" />
                  ) : null}
                </div>
              </TD>
              <TD className="tabular hidden text-fg-muted sm:table-cell">v{f.versionNumber ?? 1}</TD>
              <TD className="tabular hidden text-fg-muted lg:table-cell">
                {f.sizeBytes ? formatBytes(f.sizeBytes) : "—"}
              </TD>
              <TD className="hidden text-fg-muted lg:table-cell">{formatDate(f.updatedAt)}</TD>
              <TD className="relative z-10">
                <FavoriteButton fileId={f.id} initial={f.favorite} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {files.map((f) => (
        <li key={f.id} className="group relative">
          <Link
            href={`${base}/${f.id}`}
            className="block overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <FileThumb
              versionId={f.versionId}
              mimeType={f.mimeType}
              name={f.name}
              hasThumbnail={f.hasThumbnail}
              className="aspect-[4/3] w-full"
              rounded=""
            />
            <div className="grid gap-1 border-t border-border p-2.5">
              <p className="truncate text-[13px] font-medium" title={f.name}>
                {f.name}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-fg-muted">{f.clientName ?? "Interno"}</span>
                <span className="tabular text-[11px] text-fg-subtle">v{f.versionNumber ?? 1}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <FileStatusBadge status={f.status} />
                {internal && f.sharedWithClient ? (
                  <Share2 className="size-3.5 text-fg-subtle" aria-label="Compartilhado com o cliente" />
                ) : null}
              </div>
            </div>
          </Link>
          <FavoriteButton
            fileId={f.id}
            initial={f.favorite}
            className="absolute top-2 right-2 bg-surface/90 opacity-100 shadow-xs backdrop-blur aria-pressed:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          />
        </li>
      ))}
    </ul>
  );
}
