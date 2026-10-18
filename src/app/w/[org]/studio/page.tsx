import { Archive, ImageUp, LayoutTemplate, Palette, Plus, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { DesignCardActions } from "@/components/studio/design-card-actions";
import { ImportTemplateDialog } from "@/components/studio/import-template-dialog";
import { NewDesignDialog } from "@/components/studio/new-design-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { relativeFromNow } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getPickerData } from "@/server/services/ai-models";
import { clientOptions } from "@/server/services/clients";
import { listDesigns } from "@/server/services/designs";
import { projectOptions } from "@/server/services/projects";

export const metadata: Metadata = { title: "Estúdio" };

export default async function StudioPage({ params, searchParams }: PageProps<"/w/[org]/studio">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "designs.read" });
  const tab = sp.tab === "templates" ? "templates" : sp.tab === "archived" ? "archived" : "designs";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const clientId = typeof sp.clientId === "string" ? sp.clientId : undefined;
  const canAi = can(actor, "ai.use");
  const data = await inOrg(actor, async (s) => ({
    items: await listDesigns(s, { q, clientId, templates: tab === "templates", archived: tab === "archived" }),
    templates: await listDesigns(s, { templates: true }),
    clients: await clientOptions(s),
    projects: await projectOptions(s),
    picker: canAi && can(actor, "designs.write") ? await getPickerData(s) : null,
  }));
  const base = `/w/${actor.orgSlug}/studio`;
  const canWrite = can(actor, "designs.write");
  const canTemplates = can(actor, "templates.manage");
  const canDelete = can(actor, "designs.delete");
  const dialog = (trigger: React.ReactNode, templateId?: string) => (
    <NewDesignDialog
      trigger={trigger}
      clients={data.clients}
      projects={data.projects}
      templates={data.templates.map((t) => ({
        id: t.id,
        name: t.name,
        width: t.width,
        height: t.height,
        thumbnail: t.thumbnail,
      }))}
      canManageTemplates={canTemplates}
      defaultTemplateId={templateId}
    />
  );

  return (
    <>
      <PageHeader
        title="Estúdio"
        description="Editor de artes com a identidade de cada cliente. Exporte direto para Arquivos e envie para aprovação."
        actions={
          canWrite ? (
            <>
              {canAi ? (
                <Button asChild variant="secondary">
                  <Link href={`${base}/gerar`}>
                    <Sparkles /> Gerar carrossel com IA
                  </Link>
                </Button>
              ) : null}
              <ImportTemplateDialog
                trigger={
                  <Button variant="secondary">
                    <ImageUp /> Importar JPG/PNG
                  </Button>
                }
                clients={data.clients}
                canManageTemplates={canTemplates}
                picker={data.picker}
              />
              {dialog(
                <Button variant="primary">
                  <Plus /> Nova arte
                </Button>,
              )}
            </>
          ) : null
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedNav
            param="tab"
            items={[
              { label: "Artes", href: base, value: "designs", icon: <Palette /> },
              { label: "Templates", href: `${base}?tab=templates`, value: "templates", icon: <LayoutTemplate /> },
              { label: "Arquivadas", href: `${base}?tab=archived`, value: "archived", icon: <Archive /> },
            ]}
          />
          <FilterBar>
            <SearchFilter placeholder="Buscar arte" />
            <SelectFilter
              param="clientId"
              label="Cliente"
              options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FilterBar>
        </div>
      </PageHeader>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={tab === "templates" ? LayoutTemplate : tab === "archived" ? Archive : Palette}
            title={
              tab === "templates"
                ? "Nenhum template ainda"
                : tab === "archived"
                  ? "Nada arquivado"
                  : "Nenhuma arte ainda"
            }
            description={
              tab === "templates"
                ? "Templates aceleram a produção: crie um a partir de uma arte aprovada ou importe um JPG/PNG."
                : tab === "archived"
                  ? "Artes arquivadas ficam aqui e podem voltar ao Estúdio quando você quiser."
                  : "Crie uma arte em branco ou a partir de um template."
            }
            action={
              canWrite && tab !== "archived"
                ? dialog(
                    <Button variant="primary">
                      <Plus /> Nova arte
                    </Button>,
                  )
                : null
            }
          />
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.items.map((d) => (
            <li key={d.id} className="group relative">
              <Link
                href={`${base}/${d.id}`}
                className="block overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow hover:shadow-md"
              >
                <div className="flex aspect-square items-center justify-center bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface)_0_50%)] bg-[length:16px_16px] p-3">
                  {d.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.thumbnail}
                      alt=""
                      className="max-h-full max-w-full rounded-sm object-contain shadow-sm"
                    />
                  ) : (
                    <Palette className="size-8 text-fg-subtle" />
                  )}
                </div>
                <div className="border-t border-border px-3 py-2.5">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {d.clientName ?? "Sem cliente"} · {d.width}×{d.height}
                    {d.pageCount > 1 ? ` · ${d.pageCount} páginas` : ""}
                  </p>
                  <p className="truncate text-[11px] text-fg-subtle">Editado {relativeFromNow(d.updatedAt)}</p>
                </div>
              </Link>
              {canWrite || canDelete ? (
                <div className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                  <DesignCardActions
                    id={d.id}
                    name={d.name}
                    isTemplate={d.isTemplate}
                    canManageTemplates={canTemplates}
                    canDelete={canDelete}
                    archived={tab === "archived"}
                  />
                </div>
              ) : null}
              {tab === "templates" && canWrite ? (
                <div className="mt-2">
                  {dialog(
                    <Button variant="secondary" size="sm" className="w-full">
                      Usar template
                    </Button>,
                    d.id,
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
