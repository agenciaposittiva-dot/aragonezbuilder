import { FolderOpen, LayoutGrid, List } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { FileCollection } from "@/components/files/file-collection";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { cn } from "@/lib/utils";
import { FILE_CATEGORIES, FILE_CATEGORY_LABEL } from "@/lib/validators/files";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { listFiles } from "@/server/services/files";
import { listProjects } from "@/server/services/projects";
import { parseFileFilters } from "@/server/services/files-page";

export const metadata: Metadata = { title: "Materiais" };

const FILTER_KEYS = ["q", "category", "projectId", "status"];

/** Abas da central de arquivos do cliente (filtros aplicados no servidor). */
const GROUPS = {
  review: { label: "Em revisão", filter: { status: "in_review" as const } },
  approved: { label: "Aprovados", filter: { status: "approved" as const } },
  final: { label: "Finais", filter: { status: "final" as const } },
  references: { label: "Enviados por vocês", filter: { category: "reference" as const } },
};

export default async function PortalFilesPage({ params, searchParams }: PageProps<"/portal/[org]/[client]/files">) {
  const { org, client: clientSlug } = await params;
  const sp = await searchParams;
  const portal = await requirePortal(org, clientSlug, { permission: "files.read" });
  const { actor } = portal;
  // Só arquivos compartilhados com este cliente (o ator já vem restrito a ele).
  // Pastas, etiquetas e favoritos são da organização da agência e não aparecem aqui.
  const f = parseFileFilters(sp);
  const groupKey = typeof sp.status === "string" && sp.status in GROUPS ? (sp.status as keyof typeof GROUPS) : null;
  const filters = {
    q: f.q,
    category: f.category,
    projectId: f.projectId,
    page: f.page,
    ...(groupKey ? GROUPS[groupKey].filter : {}),
  };
  const data = await inOrg(actor, async (s) => ({
    list: await listFiles(s, filters),
    projects: actor.permissions.has("projects.read") ? (await listProjects(s, { view: "board" })).rows : [],
  }));
  const base = `${portal.base}/files`;
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
        <SegmentedNav
          param="status"
          items={[
            { label: "Todos", href: base, value: "" },
            ...Object.entries(GROUPS).map(([value, g]) => ({ label: g.label, href: `${base}?status=${value}`, value })),
          ]}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterBar>
            <SearchFilter placeholder="Buscar por nome" />
            {data.projects.length ? (
              <SelectFilter
                param="projectId"
                label="Projeto"
                options={data.projects.map((p) => ({ value: p.id, label: p.name }))}
              />
            ) : null}
            <SelectFilter
              param="category"
              label="Categoria"
              options={FILE_CATEGORIES.filter((c) => c !== "template" && c !== "reference").map((c) => ({
                value: c,
                label: FILE_CATEGORY_LABEL[c],
              }))}
            />
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
