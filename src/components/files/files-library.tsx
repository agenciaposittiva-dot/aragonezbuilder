import { FolderOpen, LayoutGrid, List, Upload } from "lucide-react";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { FILE_CATEGORIES, FILE_CATEGORY_LABEL, FILE_STATUS_LABEL, FILE_STATUSES } from "@/lib/validators/files";
import type { FileListRow } from "@/server/services/files";
import { FileCollection } from "./file-collection";
import { FolderTree, type FolderNode } from "./folder-tree";
import { UploadDialog } from "./upload-dialog";

type Option = { id: string; name: string };

/**
 * Biblioteca de arquivos reutilizada na central, no cliente e no projeto.
 * Filtros e pasta ativa ficam na URL.
 */
export function FilesLibrary({
  rows,
  total,
  page,
  pageSize,
  searchParams,
  basePath,
  folders,
  scope,
  clients,
  projects,
  canWrite,
  maxBytes,
}: {
  rows: FileListRow[];
  total: number;
  page: number;
  pageSize: number;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
  folders: FolderNode[];
  scope: { clientId?: string | null; projectId?: string | null };
  clients?: Option[];
  projects?: (Option & { clientId: string })[];
  canWrite: boolean;
  maxBytes: number;
}) {
  const view = searchParams.view === "list" ? "list" : "grid";
  const folderId =
    typeof searchParams.folderId === "string" && searchParams.folderId !== "root" ? searchParams.folderId : null;
  const viewHref = (v: "grid" | "list") => {
    const qs = new URLSearchParams();
    for (const [k, val] of Object.entries(searchParams)) if (typeof val === "string" && k !== "view") qs.set(k, val);
    if (v === "list") qs.set("view", "list");
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const filtered = ["q", "category", "status", "tag", "favorites", "final", "clientId", "projectId"].some(
    (k) => searchParams[k],
  );

  const uploadButton = canWrite ? (
    <UploadDialog
      target={{ clientId: scope.clientId ?? null, projectId: scope.projectId ?? null, folderId }}
      clients={scope.clientId ? undefined : clients}
      projects={scope.projectId ? undefined : projects?.filter((p) => !scope.clientId || p.clientId === scope.clientId)}
      folders={folders.map((f) => ({ id: f.id, name: f.name }))}
      maxBytes={maxBytes}
      trigger={
        <Button variant="primary">
          <Upload /> Enviar arquivos
        </Button>
      }
    />
  ) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card className="p-2">
          <FolderTree folders={folders} canWrite={canWrite} scope={scope} />
        </Card>
      </aside>
      <div className="grid min-w-0 content-start gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <FilterBar>
            <SearchFilter placeholder="Buscar por nome ou etiqueta" />
            {clients && !scope.clientId ? (
              <SelectFilter
                param="clientId"
                label="Cliente"
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            ) : null}
            {projects && !scope.projectId ? (
              <SelectFilter
                param="projectId"
                label="Projeto"
                options={projects
                  .filter((p) => !scope.clientId || p.clientId === scope.clientId)
                  .map((p) => ({ value: p.id, label: p.name }))}
              />
            ) : null}
            <SelectFilter
              param="category"
              label="Categoria"
              options={FILE_CATEGORIES.map((c) => ({ value: c, label: FILE_CATEGORY_LABEL[c] }))}
            />
            <SelectFilter
              param="status"
              label="Status"
              options={FILE_STATUSES.map((st) => ({ value: st, label: FILE_STATUS_LABEL[st] }))}
            />
            <SelectFilter param="final" label="Todos" options={[{ value: "1", label: "Aprovados e finais" }]} />
            <SelectFilter param="favorites" label="Favoritos" options={[{ value: "1", label: "Só favoritos" }]} />
            <ClearFilters keys={["q", "category", "status", "tag", "favorites", "final", "clientId", "projectId"]} />
          </FilterBar>
          <div className="flex items-center gap-2">
            <div
              className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
              role="group"
              aria-label="Visualização"
            >
              {(["grid", "list"] as const).map((v) => (
                <Link
                  key={v}
                  href={viewHref(v)}
                  aria-current={view === v ? "true" : undefined}
                  aria-label={v === "grid" ? "Grade" : "Lista"}
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:text-fg",
                    view === v && "bg-surface text-fg shadow-xs",
                  )}
                >
                  {v === "grid" ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}
                </Link>
              ))}
            </div>
            {uploadButton}
          </div>
        </div>
        <Card>
          {rows.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={filtered ? "Nenhum arquivo encontrado" : "Nenhum arquivo por aqui"}
              description={
                filtered
                  ? "Ajuste a busca ou os filtros."
                  : "Envie peças, referências e documentos. Versões e aprovações ficam registradas."
              }
              action={filtered ? null : uploadButton}
            />
          ) : (
            <>
              <FileCollection files={rows} view={view} />
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                searchParams={searchParams}
                basePath={basePath}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
