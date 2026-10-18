import { Camera, Link2, ScanSearch, Users2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ScoreBadge } from "@/components/brand-radar/bits";
import { NewProfileDialog, RadarSettingsDialog } from "@/components/brand-radar/radar-forms";
import { ClearFilters, FilterBar, SelectFilter } from "@/components/app/filters";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { BRAND_DIMENSIONS, DIMENSION_KEYS } from "@/lib/brand-radar";
import { formatDate } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listRadarProfiles, radarFormOptions, radarSettings } from "@/server/services/brand-radar";

export const metadata: Metadata = { title: "Radar de Marca" };

const CONNECTION = {
  connected: { label: "Conta conectada", tone: "success" },
  expired: { label: "Autorização vencida", tone: "warning" },
  revoked: { label: "Autorização revogada", tone: "warning" },
  error: { label: "Erro na conexão", tone: "danger" },
} as const;

export default async function BrandRadarPage({ params, searchParams }: PageProps<"/w/[org]/brand-radar">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "brand.read" });
  const clientId = typeof sp.client === "string" && /^[0-9a-f-]{36}$/i.test(sp.client) ? sp.client : undefined;
  const data = await inOrg(actor, async (s) => ({
    profiles: await listRadarProfiles(s, { clientId }),
    options: await radarFormOptions(s),
    settings: await radarSettings(s),
  }));
  const base = `/w/${actor.orgSlug}/brand-radar`;
  const canManage = can(actor, "brand.manage");

  return (
    <>
      <PageHeader
        title="Radar de Marca"
        description="Diagnóstico estratégico do Instagram de cada cliente — bio, destaques, identidade visual, conteúdo, nicho e plano de ação —, com a fonte e a data de cada dado."
        actions={
          <>
            {can(actor, "org.manage") ? <RadarSettingsDialog settings={data.settings} /> : null}
            {canManage && data.options.clients.length ? (
              <NewProfileDialog clients={data.options.clients} defaultClientId={clientId} />
            ) : null}
          </>
        }
      />

      <FilterBar className="mb-4">
        <SelectFilter
          param="client"
          label="Cliente"
          options={data.options.clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <ClearFilters keys={["client"]} />
      </FilterBar>

      {data.profiles.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="radar-profiles">
          {data.profiles.map((p) => {
            const conn = p.connection ? CONNECTION[p.connection as keyof typeof CONNECTION] : null;
            return (
              <li key={p.id}>
                <Link
                  href={`${base}/${p.id}`}
                  className="grid h-full content-start gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors hover:bg-surface-2/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">@{p.handle}</p>
                      <p className="truncate text-xs text-fg-muted">{p.clientName}</p>
                    </div>
                    <ScoreBadge score={p.lastScore ?? null} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.niche ? <Badge tone="outline">{p.niche}</Badge> : null}
                    {conn ? <Badge tone={conn.tone}>{conn.label}</Badge> : <Badge tone="outline">Entrada manual</Badge>}
                    {p.lastDemo ? <Badge tone="warning">Demonstração</Badge> : null}
                  </div>
                  <p className="text-xs text-fg-subtle">
                    {p.lastAt ? `Último diagnóstico em ${formatDate(p.lastAt)}` : "Ainda sem diagnóstico"}
                    {p.openRecommendations ? ` · ${p.openRecommendations} recomendação(ões) em aberto` : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl border border-border bg-surface shadow-xs">
          <EmptyState
            icon={ScanSearch}
            title={clientId ? "Nenhum perfil deste cliente no Radar" : "Nenhum perfil no Radar ainda"}
            description="Comece pelo @ ou endereço do perfil e escolha o cliente. Depois conecte a conta oficial ou informe os dados e capturas de tela."
            action={
              canManage && data.options.clients.length ? (
                <NewProfileDialog clients={data.options.clients} defaultClientId={clientId} />
              ) : !data.options.clients.length ? (
                <p className="text-xs text-fg-muted">
                  Cadastre um cliente primeiro: todo perfil analisado pertence a um cliente.
                </p>
              ) : null
            }
          />
          <ul className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-3">
            <li className="flex gap-2">
              <Users2 className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
              <span>
                <strong className="font-medium">Por cliente ou @</strong>
                <span className="block text-xs text-fg-muted">
                  Cada perfil fica ligado a um cliente e às permissões dele.
                </span>
              </span>
            </li>
            <li className="flex gap-2">
              <Link2 className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
              <span>
                <strong className="font-medium">Conexão oficial</strong>
                <span className="block text-xs text-fg-muted">
                  Login do próprio Instagram (API da Meta), para métricas reais. Nunca pedimos senha.
                </span>
              </span>
            </li>
            <li className="flex gap-2">
              <Camera className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
              <span>
                <strong className="font-medium">Entrada manual</strong>
                <span className="block text-xs text-fg-muted">
                  Bio, destaques, publicações e capturas de tela informadas pela equipe.
                </span>
              </span>
            </li>
          </ul>
        </div>
      )}

      <details className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm shadow-xs">
        <summary className="cursor-pointer font-medium">Como a nota é calculada</summary>
        <p className="mt-2 text-xs text-fg-muted">
          A nota de 0 a 100 é a média ponderada das dimensões avaliadas. Dimensões sem dados suficientes ficam de fora e
          aparecem como “não avaliadas” — nada é estimado. Completude, formatos e desempenho seguem regras objetivas; as
          demais são avaliações da IA, sempre marcadas como tal. Limite da bio: {data.settings.bioLimit} caracteres.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-fg-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">Dimensão</th>
                <th className="py-1 pr-3 font-medium">Peso</th>
                <th className="py-1 pr-3 font-medium">Quem avalia</th>
                <th className="py-1 font-medium">Critério</th>
              </tr>
            </thead>
            <tbody>
              {DIMENSION_KEYS.map((k) => (
                <tr key={k} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{BRAND_DIMENSIONS[k].label}</td>
                  <td className="tabular py-1.5 pr-3">{data.settings.weights[k]}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {BRAND_DIMENSIONS[k].kind === "objective" ? "Regra objetiva" : "IA"}
                  </td>
                  <td className="py-1.5 text-fg-muted">{BRAND_DIMENSIONS[k].criteria}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
