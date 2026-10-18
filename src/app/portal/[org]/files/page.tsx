import { FolderOpen, LayoutGrid, List } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { FileCollection } from "@/components/files/file-collection";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { FILE_CATEGORIES, FILE_CATEGORY_LABEL } from "@/lib/validators/files";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listFiles } from "@/server/services/files";
import { parseFileFilters } from "@/server/services/files-page";

export const metadata: Metadata = { title: "Materiais" };

const FILTER_KEYS = ["q", "category", "final", "clientId"];

export default async function PortalFilesPage({ params, searchParams }: PageProps<"/portal/[org]/files">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "client", permission: "files.read" });
  // Pastas, status internos e favoritos são da organização da agência; o cliente
  // filtra só por nome, categoria, marca e materiais aprovados.
  const f = parseFileFilters(sp);
  const filters = { q: f.q, category: f.category, final: f.final, clientId: f.clientId, page: f.page };
  const data = await inOrg(actor, async (s) => ({
    list: await listFiles(s, filters),
    clients: actor.clientIds.length > 1 ? await clientOptions(s) : [],
  }));
  const base = `/portal/${actor.orgSlug}/files`;
  const view = sp.view === "list" ? "list" : "grid";
  const filtered = FILTER_KEYS.some((k) => sp[k]);
  const viewHref = (v: "grid" | "list") => {
    const qs = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (typeof val === "string" && k !== "view") qs.set(k, val);
    if (v === "list") qs.set("view", "list");
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <>
      <PageHeader title="Materiais" description="Peças, documentos e arquivos que a agência compartilhou com você.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterBar>
            <SearchFilter placeholder="Buscar por nome" />
            {data.clients.length > 1 ? (
              <SelectFilter
                param="clientId"
                label="Marca"
                options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            ) : null}
            <SelectFilter
              param="category"
              label="Categoria"
              options={FILE_CATEGORIES.filter((c) => c !== "template").map((c) => ({
                value: c,
                label: FILE_CATEGORY_LABEL[c],
              }))}
            />
            <SelectFilter param="final" label="Todos" options={[{ value: "1", label: "Aprovados e finais" }]} />
            <ClearFilters keys={FILTER_KEYS} />
          </FilterBar>
          <div
            className="inline-flex self-start rounded-lg border border-border bg-surface-2 p-0.5"
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
        </div>
      </PageHeader>
      <Card>
        {data.list.rows.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={filtered ? "Nenhum material encontrado" : "Nenhum material compartilhado ainda"}
            description={
              filtered
                ? "Ajuste a busca ou os filtros."
                : "Quando a agência compartilhar peças e documentos com você, eles aparecem aqui."
            }
          />
        ) : (
          <>
            <FileCollection files={data.list.rows} view={view} />
            <Pagination
              page={data.list.page}
              pageSize={data.list.pageSize}
              total={data.list.total}
              searchParams={sp}
              basePath={base}
            />
          </>
        )}
      </Card>
    </>
  );
}
