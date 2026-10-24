import { Archive, ImageUp, LayoutTemplate, Palette, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { DesignCardActions } from "@/components/studio/design-card-actions";
import { ImportTemplateDialog } from "@/components/studio/import-template-dialog";
import { NewDesignDialog } from "@/components/studio/new-design-dialog";
import { StudioHero } from "@/components/studio/studio-home";
import { TemplateGallery } from "@/components/studio/template-gallery";
import { TemplateLibrary } from "@/components/studio/template-library";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { FORMAT_FILTERS, OTHER_CATEGORY, TEMPLATE_CATEGORIES } from "@/lib/design-doc/template-categories";
import { relativeFromNow } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getPickerData } from "@/server/services/ai-models";
import { clientOptions } from "@/server/services/clients";
import { listDesigns } from "@/server/services/designs";
import { maxUploadBytes } from "@/server/services/files";
import { projectOptions } from "@/server/services/projects";
import { listTemplateLibrary } from "@/server/services/template-library";

export const metadata: Metadata = { title: "Estúdio Criador" };

/**
 * Estúdio Criador: entrada com criação por IA e cartões de formato, galeria
 * de modelos por categoria e as artes da agência. As rotas (/studio) e os
 * registros (designs/templates) são os mesmos do editor.
 */
export default async function StudioPage({ params, searchParams }: PageProps<"/w/[org]/studio">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "designs.read" });
  const tab = sp.tab === "templates" ? "templates" : sp.tab === "archived" ? "archived" : "designs";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const clientId = typeof sp.clientId === "string" ? sp.clientId : undefined;
  const category = typeof sp.categoria === "string" && sp.categoria ? sp.categoria : null;
  const format = typeof sp.formato === "string" && FORMAT_FILTERS.some((f) => f.key === sp.formato) ? sp.formato : null;
  const canAi = can(actor, "ai.use");
  const canWrite = can(actor, "designs.write");
  const canTemplates = can(actor, "templates.manage");
  const canDelete = can(actor, "designs.delete");
  const data = await inOrg(actor, async (s) => ({
    items: tab === "templates" ? [] : await listDesigns(s, { q, clientId, archived: tab === "archived" }),
    // Modelos da agência: alimentam a galeria e o seletor de "Nova arte".
    templates: await listDesigns(s, {
      templates: true,
      q: tab === "templates" ? q : undefined,
      favorites: tab === "templates" && sp.favoritos === "1",
    }),
    clients: await clientOptions(s),
    projects: await projectOptions(s),
    picker: canAi && canWrite ? await getPickerData(s) : null,
    library: tab === "templates" ? await listTemplateLibrary(s) : null,
    maxBytes: maxUploadBytes(s),
  }));
  const base = `/w/${actor.orgSlug}/studio`;
  const dialogData = {
    clients: data.clients,
    projects: data.projects,
    templates: data.templates.map((t) => ({
      id: t.id,
      name: t.name,
      width: t.width,
      height: t.height,
      thumbnail: t.thumbnail,
    })),
    canManageTemplates: canTemplates,
  };
  const gallery = { base, dialog: dialogData, canWrite, canTemplates, canDelete };
  const browsing = Boolean(q || clientId);
  const newDesign = (trigger: React.ReactNode) => <NewDesignDialog trigger={trigger} {...dialogData} />;

  return (
    <>
      <PageHeader
        title="Estúdio Criador"
        description="Posts, carrosséis e vídeos verticais com a identidade de cada cliente — do zero, de um modelo ou com IA. Exporte para Arquivos e envie para aprovação."
        actions={
          canWrite ? (
            <>
              <ImportTemplateDialog
                trigger={
                  <Button variant="secondary">
                    <ImageUp /> Importar JPG/PNG
                  </Button>
                }
                clients={data.clients}
                canManageTemplates={canTemplates}
                picker={data.picker}
                maxBytes={data.maxBytes}
              />
              {newDesign(
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
              { label: "Início", href: base, value: "designs", icon: <Palette /> },
              { label: "Modelos", href: `${base}?tab=templates`, value: "templates", icon: <LayoutTemplate /> },
              { label: "Arquivadas", href: `${base}?tab=archived`, value: "archived", icon: <Archive /> },
            ]}
          />
          <FilterBar>
            <SearchFilter placeholder={tab === "templates" ? "Buscar modelo" : "Buscar arte"} />
            {tab === "templates" ? (
              <>
                <SelectFilter
                  param="categoria"
                  label="Categoria"
                  options={[...TEMPLATE_CATEGORIES, OTHER_CATEGORY].map((c) => ({ value: c, label: c }))}
                />
                <SelectFilter
                  param="formato"
                  label="Formato"
                  options={FORMAT_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
                />
                <SelectFilter param="favoritos" label="Favoritos" options={[{ value: "1", label: "Só favoritos" }]} />
              </>
            ) : (
              <SelectFilter
                param="clientId"
                label="Cliente"
                options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          </FilterBar>
        </div>
      </PageHeader>

      {tab === "designs" && !browsing && canWrite ? <StudioHero base={base} canAi={canAi} dialog={dialogData} /> : null}

      {tab === "designs" && !browsing && data.templates.length ? (
        <section aria-labelledby="start-with-template" className="mt-8">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="start-with-template" className="text-xs font-semibold tracking-[0.18em] text-fg-muted uppercase">
              Comece com um modelo
            </h2>
            <Link href={`${base}?tab=templates`} className="text-xs font-medium text-fg-muted hover:text-fg">
              Ver todos os modelos ({data.templates.length})
            </Link>
          </div>
          <TemplateGallery items={data.templates} variant="home" {...gallery} />
        </section>
      ) : null}

      {tab === "templates" ? (
        <div className="grid gap-6">
          {data.library ? <TemplateLibrary items={data.library} /> : null}
          <TemplateGallery items={data.templates} variant="all" filters={{ category, format }} {...gallery} />
        </div>
      ) : (
        <section aria-labelledby="designs-title" className={tab === "designs" && !browsing ? "mt-8" : undefined}>
          <h2 id="designs-title" className="mb-3 text-xs font-semibold tracking-[0.18em] text-fg-muted uppercase">
            {tab === "archived" ? "Arquivadas" : browsing ? "Resultados" : "Suas artes"}
            <span className="ml-1 font-normal tracking-normal normal-case">· {data.items.length}</span>
          </h2>
          {data.items.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface">
              <EmptyState
                icon={tab === "archived" ? Archive : Palette}
                title={
                  tab === "archived" ? "Nada arquivado" : browsing ? "Nenhuma arte encontrada" : "Nenhuma arte ainda"
                }
                description={
                  tab === "archived"
                    ? "Artes arquivadas ficam aqui e podem voltar ao Estúdio quando você quiser."
                    : browsing
                      ? "Ajuste a busca ou o filtro de cliente."
                      : "Crie uma arte em branco, use um modelo ou gere um carrossel com IA."
                }
                action={
                  canWrite && tab !== "archived"
                    ? newDesign(
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
                    <div className="flex aspect-[4/5] items-center justify-center bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface)_0_50%)] bg-[length:16px_16px] p-3">
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
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
