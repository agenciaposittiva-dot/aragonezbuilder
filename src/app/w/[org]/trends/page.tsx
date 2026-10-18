import { Bookmark, EyeOff, Eye, FolderOpen, Layers, Radar, Settings2, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { TrendCard } from "@/components/trends/trend-card";
import {
  ClassifyButton,
  ClientFitPanel,
  DeleteCollectionButton,
  NewCollectionForm,
  RefreshTrendsButton,
} from "@/components/trends/trends-actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { relativeFromNow } from "@/lib/format";
import {
  TREND_LANGUAGES,
  TREND_PERIODS,
  TREND_PLATFORMS,
  TREND_REGIONS,
  TREND_TABS,
  TREND_TYPES,
  trendListParams,
} from "@/lib/trends";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getPickerData } from "@/server/services/ai-models";
import { clientOptions } from "@/server/services/clients";
import { listCollections, listSources, listTrends, nicheOptions } from "@/server/services/trends";

export const metadata: Metadata = { title: "Radar de Tendências" };
// Classificação e perguntas por cliente chamam a IA a partir desta página.
export const maxDuration = 60;

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function TrendsPage({ params, searchParams }: PageProps<"/w/[org]/trends">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "trends.read" });
  const parsed = trendListParams.safeParse({
    q: str(sp.q),
    niche: str(sp.niche),
    region: str(sp.region),
    language: str(sp.language),
    platform: str(sp.platform),
    type: str(sp.type),
    period: str(sp.period),
    tab: str(sp.tab),
    collectionId: str(sp.collectionId),
    page: str(sp.page),
  });
  const filters = parsed.success ? parsed.data : trendListParams.parse({});
  const data = await inOrg(actor, async (s) => ({
    sources: await listSources(s),
    list: await listTrends(s, filters),
    niches: await nicheOptions(s),
    collections: await listCollections(s),
    clients: await clientOptions(s),
    picker: await getPickerData(s),
  }));
  const base = `/w/${actor.orgSlug}/trends`;
  const canManage = can(actor, "trends.manage");
  const lastSuccess = data.sources
    .map((x) => x.lastSuccessAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const failing = data.sources.filter((x) => x.enabled && x.lastError);
  const activeCollection = data.collections.find((c) => c.id === filters.collectionId);
  const tabHref = (tab: string) => (tab === "all" ? base : `${base}?tab=${tab}`);

  return (
    <>
      <PageHeader
        title="Radar de Tendências"
        description="Assuntos em alta nas fontes públicas (Google Trends, Wikipédia, YouTube, notícias) e datas comemorativas, com análise da IA separada do que foi observado."
        actions={
          <>
            {canManage ? <RefreshTrendsButton /> : null}
            <ClassifyButton
              trendIds={data.list.rows.filter((r) => !r.classification).map((r) => r.id)}
              picker={data.picker}
            />
            {canManage ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}/sources`}>
                  <Settings2 /> Fontes
                </Link>
              </Button>
            ) : null}
          </>
        }
      >
        <p className="text-xs text-fg-muted" data-testid="trends-last-update">
          {lastSuccess
            ? `Última atualização: ${relativeFromNow(lastSuccess)}`
            : "Ainda sem coletas — use “Atualizar agora” ou aguarde a rotina diária."}
          {failing.length ? (
            <span className="text-warning">
              {" "}
              · {failing.length} fonte(s) com erro na última tentativa{canManage ? " (veja em Fontes)" : ""}
            </span>
          ) : null}
        </p>
        <div className="flex flex-col gap-3">
          <SegmentedNav
            param="tab"
            items={[
              { label: TREND_TABS.all, href: tabHref("all"), value: "all", icon: <Radar /> },
              { label: TREND_TABS.saved, href: tabHref("saved"), value: "saved", icon: <Bookmark /> },
              { label: TREND_TABS.favorite, href: tabHref("favorite"), value: "favorite", icon: <Star /> },
              { label: TREND_TABS.following, href: tabHref("following"), value: "following", icon: <Eye /> },
              { label: TREND_TABS.dismissed, href: tabHref("dismissed"), value: "dismissed", icon: <EyeOff /> },
            ]}
          />
          <FilterBar>
            <SearchFilter placeholder="Buscar assunto" />
            <SelectFilter param="niche" label="Nicho" options={data.niches} />
            <SelectFilter
              param="period"
              label="Período (7 dias)"
              options={Object.entries(TREND_PERIODS).map(([value, label]) => ({ value, label }))}
            />
            <SelectFilter
              param="platform"
              label="Plataforma"
              options={Object.entries(TREND_PLATFORMS).map(([value, label]) => ({ value, label }))}
            />
            <SelectFilter
              param="type"
              label="Tipo"
              options={Object.entries(TREND_TYPES).map(([value, label]) => ({ value, label }))}
            />
            <SelectFilter
              param="region"
              label="Mercado"
              options={Object.entries(TREND_REGIONS).map(([value, label]) => ({ value, label }))}
            />
            <SelectFilter
              param="language"
              label="Idioma"
              options={Object.entries(TREND_LANGUAGES).map(([value, label]) => ({ value, label }))}
            />
            <ClearFilters keys={["q", "niche", "period", "platform", "type", "region", "language", "collectionId"]} />
          </FilterBar>
        </div>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-3">
          {activeCollection ? (
            <p className="flex items-center gap-1.5 text-sm">
              <FolderOpen className="size-4 text-fg-subtle" /> Coleção: <strong>{activeCollection.name}</strong>
            </p>
          ) : null}
          {data.list.rows.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface">
              <EmptyState
                icon={Radar}
                title={
                  filters.tab === "all" ? "Nenhuma tendência neste filtro" : `Nada em “${TREND_TABS[filters.tab]}”`
                }
                description={
                  lastSuccess
                    ? "Ajuste os filtros ou o período. Datas comemorativas aparecem em “Próximas datas”."
                    : "As fontes ainda não foram coletadas. Quem gerencia o Radar pode atualizar agora em Fontes."
                }
              />
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {data.list.rows.map((t) => (
                <li key={t.id} className="flex">
                  <TrendCard base={base} trend={t} collections={data.collections} />
                </li>
              ))}
            </ul>
          )}
          <Pagination
            page={data.list.page}
            pageSize={data.list.pageSize}
            total={data.list.total}
            searchParams={sp}
            basePath={base}
          />
        </div>

        <aside className="grid content-start gap-4">
          <ClientFitPanel base={base} clients={data.clients} picker={data.picker} defaultClientId={str(sp.clientId)} />
          <section className="grid gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Layers className="size-4 text-fg-subtle" /> Coleções
            </h2>
            {data.collections.length ? (
              <ul className="grid gap-0.5">
                {data.collections.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`${base}?tab=all&collectionId=${c.id}`}
                      className="min-w-0 truncate rounded px-1 py-0.5 text-sm hover:bg-surface-2"
                    >
                      {c.name} <span className="text-xs text-fg-subtle">({c.items})</span>
                    </Link>
                    <DeleteCollectionButton id={c.id} name={c.name} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-muted">Agrupe tendências por campanha, cliente ou tema.</p>
            )}
            <NewCollectionForm />
          </section>
          <section className="grid gap-1.5 rounded-xl border border-border bg-surface p-4 text-xs shadow-xs">
            <h2 className="text-sm font-semibold">Fontes</h2>
            <ul className="grid gap-1">
              {data.sources.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-2">
                  <span className={x.enabled && x.available ? "" : "text-fg-subtle"}>{x.name}</span>
                  <span className="shrink-0 text-right text-fg-subtle">
                    {!x.enabled
                      ? "desativada"
                      : !x.available
                        ? "indisponível"
                        : x.lastSuccessAt
                          ? relativeFromNow(x.lastSuccessAt)
                          : "sem coleta"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}
