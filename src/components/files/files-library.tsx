import { FolderOpen, LayoutGrid, List, Palette, Upload } from "lucide-react";
import Link from "next/link";
import { ClearFilters, DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { relativeFromNow } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  FILE_CATEGORIES,
  FILE_CATEGORY_LABEL,
  FILE_SORTS,
  FILE_STATUS_LABEL,
  FILE_STATUSES,
  FILE_TYPES,
} from "@/lib/validators/files";
import type { FileListRow, StorageUsage } from "@/server/services/files";
import { CloudNav } from "./cloud-nav";
import { FileCollection } from "./file-collection";
import { FolderTree, type FolderNode } from "./folder-tree";
import { MobileCollapse } from "./mobile-collapse";
import { StorageMeter } from "./storage-meter";
import { UploadDialog } from "./upload-dialog";

type Option = { id: string; name: string };

/** Extras da Minha Nuvem (central): pastas lógicas, uso do armazenamento e artes recentes. */
export type CloudExtras = {
  usage: StorageUsage;
  recentDesigns: { id: string; name: string; thumbnail: string | null; clientName: string | null; updatedAt: Date }[];
  trashHref: string | null;
  settingsHref: string | null;
  studioHref: string;
};

const FILTER_KEYS = [
  "q",
  "category",
  "status",
  "tag",
  "favorites",
  "final",
  "clientId",
  "projectId",
  "type",
  "from",
  "to",
  "kind",
  "section",
];

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
  canDelete = false,
  maxBytes,
  cloud,
  driveConnected = false,
  drivePreferred = false,
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
  canDelete?: boolean;
  maxBytes: number;
  cloud?: CloudExtras;
  /** A pessoa tem o Google Drive conectado (ações "Salvar no Google Drive"). */
  driveConnected?: boolean;
  /** O destino preferido da pessoa inclui a cópia no Drive. */
  drivePreferred?: boolean;
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
  const filtered = FILTER_KEYS.some((k) => searchParams[k]);

  const uploadButton = canWrite ? (
    <UploadDialog
      target={{ clientId: scope.clientId ?? null, projectId: scope.projectId ?? null, folderId }}
      clients={scope.clientId ? undefined : clients}
      projects={scope.projectId ? undefined : projects?.filter((p) => !scope.clientId || p.clientId === scope.clientId)}
      folders={folders.map((f) => ({ id: f.id, name: f.name }))}
      maxBytes={maxBytes}
      drive={{ connected: driveConnected, preferred: drivePreferred }}
      trigger={
        <Button variant="primary">
          <Upload /> Enviar arquivos
        </Button>
      }
    />
  ) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="grid content-start gap-3 lg:sticky lg:top-20 lg:self-start">
        {cloud ? <StorageMeter usage={cloud.usage} settingsHref={cloud.settingsHref} /> : null}
        <MobileCollapse label={cloud ? "Seções, clientes e pastas" : "Pastas"}>
          {cloud ? (
            <Card className="p-2">
              <CloudNav
                basePath={basePath}
                searchParams={searchParams}
                clients={clients ?? []}
                trashHref={cloud.trashHref}
              />
            </Card>
          ) : null}
          <Card className="p-2">
            <FolderTree folders={folders} canWrite={canWrite} scope={scope} />
          </Card>
        </MobileCollapse>
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
            <SelectFilter
              param="type"
              label="Tipo"
              options={Object.entries(FILE_TYPES).map(([value, label]) => ({ value, label }))}
            />
            <SelectFilter param="final" label="Todos" options={[{ value: "1", label: "Aprovados e finais" }]} />
            <SelectFilter param="favorites" label="Favoritos" options={[{ value: "1", label: "Só favoritos" }]} />
            <DateFilter param="from" label="Alterado de" />
            <DateFilter param="to" label="até" />
            <SelectFilter
              param="sort"
              label="Ordem"
              options={Object.entries(FILE_SORTS)
                .filter(([value]) => value !== "recent")
                .map(([value, label]) => ({ value, label }))}
            />
            <ClearFilters keys={[...FILTER_KEYS, "sort"]} />
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
        {cloud && !filtered && cloud.recentDesigns.length ? (
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Palette className="size-4" /> Artes editadas recentemente
              </h2>
              <Link href={cloud.studioHref} className="text-xs text-fg-muted hover:text-fg">
                Abrir o Estúdio
              </Link>
            </div>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {cloud.recentDesigns.map((d) => (
                <li key={d.id} className="min-w-0">
                  <Link href={`${cloud.studioHref}/${d.id}`} className="group block">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2 p-1.5 transition-colors group-hover:border-border-strong">
                      {d.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.thumbnail} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <Palette className="size-5 text-fg-subtle" />
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs font-medium">{d.name}</p>
                    <p className="truncate text-[11px] text-fg-subtle">{relativeFromNow(d.updatedAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
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
              <FileCollection
                files={rows}
                view={view}
                actions={
                  canWrite || canDelete
                    ? { canWrite, canDelete, folders: folders.map((f) => ({ id: f.id, name: f.name })), driveConnected }
                    : undefined
                }
              />
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
