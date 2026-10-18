import { ExternalLink, Info, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { CreateContentDialog } from "@/components/trends/create-content-dialog";
import { CollectionMenu, ObservedMetrics, TrendStateButtons } from "@/components/trends/trend-card";
import { formatDate, formatDateTime, relativeFromNow } from "@/lib/format";
import {
  LEVELS,
  LIFESPANS,
  nicheLabel,
  RISK_LEVELS,
  TREND_PLATFORMS,
  TREND_TYPES,
  type TrendPlatform,
} from "@/lib/trends";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getPickerData } from "@/server/services/ai-models";
import { clientOptions } from "@/server/services/clients";
import { listCampaigns } from "@/server/services/content";
import { projectOptions } from "@/server/services/projects";
import { getTrend, listCollections } from "@/server/services/trends";

export const metadata: Metadata = { title: "Tendência" };
// Geração da prévia e da imagem chamam a IA a partir desta página.
export const maxDuration = 120;

const lv = (v: string | null | undefined) => (v ? (LEVELS[v as keyof typeof LEVELS] ?? v) : "—");
const risk = (v: string | null | undefined) => (v ? (RISK_LEVELS[v as keyof typeof RISK_LEVELS] ?? v) : "—");

export default async function TrendPage({ params, searchParams }: PageProps<"/w/[org]/trends/[id]">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "trends.read" });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canContent = can(actor, "content.write");
  const data = await inOrg(actor, async (s) => {
    try {
      return {
        detail: await getTrend(s, id),
        collections: await listCollections(s),
        clients: canContent ? await clientOptions(s) : [],
        campaigns: canContent && can(actor, "content.read") ? await listCampaigns(s) : [],
        projects: canContent && can(actor, "projects.read") ? await projectOptions(s) : [],
        picker: canContent ? await getPickerData(s) : null,
      };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  const { detail } = data;
  const t = detail.trend;
  const c = detail.classification;
  const base = `/w/${actor.orgSlug}`;
  const type = t.platform === "calendar" ? "sazonal" : c?.trendType;
  // Só a análise mais recente de cada cliente (a lista vem da mais nova para a mais antiga).
  const fits = detail.clientFits.filter(
    (f, i, all) => all.findIndex((x) => x.analysis.clientId === f.analysis.clientId) === i,
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Radar de Tendências", href: `${base}/trends` }, { label: t.title }]} />
      <PageHeader
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="outline">{TREND_PLATFORMS[t.platform as TrendPlatform] ?? t.platform}</Badge>
            {(t.niche ?? c?.suggestedNiche) ? <Badge>{nicheLabel(t.niche ?? c?.suggestedNiche)}</Badge> : null}
            {t.region ? <Badge tone="outline">{t.region}</Badge> : null}
            {t.language ? <Badge tone="outline">{t.language}</Badge> : null}
          </span>
        }
        actions={
          <>
            <TrendStateButtons trendId={t.id} state={detail.state} />
            <CollectionMenu trendId={t.id} collections={data.collections} memberOf={detail.collectionIds} />
            {canContent && data.picker ? (
              <CreateContentDialog
                base={base}
                trendId={t.id}
                trendTitle={t.title}
                clients={data.clients}
                campaigns={data.campaigns.map((x) => ({ id: x.id, name: x.name, clientId: x.clientId }))}
                projects={data.projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId }))}
                picker={data.picker}
                can={{
                  designs: can(actor, "designs.write"),
                  requests: can(actor, "requests.write"),
                  tasks: can(actor, "tasks.write"),
                  projects: can(actor, "projects.write"),
                  files: can(actor, "files.write"),
                }}
                defaultOpen={sp.create === "1"}
                defaultClientId={typeof sp.clientId === "string" ? sp.clientId : undefined}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section
          aria-labelledby="observed"
          className="grid content-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs"
        >
          <h2 id="observed" className="text-sm font-semibold">
            Dados observados na fonte
          </h2>
          {t.summary ? <p className="text-sm text-fg-muted">{t.summary}</p> : null}
          <ObservedMetrics metrics={t.metrics} />
          {detail.growth.notes.length ? (
            <ul className="grid gap-0.5 text-xs text-fg-muted">
              {detail.growth.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-subtle">
              Sem comparação entre coletas ainda — crescimento só é indicado com duas medições da própria fonte.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-fg-muted">Fonte</dt>
            <dd>
              {detail.source.name}
              {t.url ? (
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 text-accent-text hover:underline"
                >
                  Abrir <ExternalLink className="size-3" />
                </a>
              ) : null}
            </dd>
            {t.eventDate ? (
              <>
                <dt className="text-fg-muted">Data</dt>
                <dd>{formatDate(t.eventDate)}</dd>
              </>
            ) : null}
            {t.publishedAt ? (
              <>
                <dt className="text-fg-muted">Publicado</dt>
                <dd>{formatDateTime(t.publishedAt)}</dd>
              </>
            ) : null}
            <dt className="text-fg-muted">Visto pela 1ª vez</dt>
            <dd>{formatDateTime(t.firstSeenAt)}</dd>
            <dt className="text-fg-muted">Última coleta</dt>
            <dd>{formatDateTime(t.lastSeenAt)}</dd>
            <dt className="text-fg-muted">Fonte atualizada</dt>
            <dd>{detail.source.lastSuccessAt ? relativeFromNow(detail.source.lastSuccessAt) : "—"}</dd>
          </dl>
          <p className="flex items-start gap-1.5 rounded-lg bg-surface-2/60 p-2 text-xs text-fg-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" /> {detail.source.info.freshness} {detail.source.info.indicators}
          </p>
          {t.related.length ? (
            <div className="grid gap-1">
              <h3 className="text-xs font-medium text-fg-muted">Relacionados</h3>
              <ul className="grid gap-1 text-xs">
                {t.related.slice(0, 8).map((r) => (
                  <li key={`${r.url ?? ""}${r.title}`}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}{" "}
                    <span className="text-fg-subtle">— {r.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {detail.observations.length ? (
            <div className="grid gap-1">
              <h3 className="text-xs font-medium text-fg-muted">Histórico de coletas</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-fg-subtle">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Dia</th>
                      <th className="py-1 pr-3 font-medium">Posição</th>
                      <th className="py-1 font-medium">Indicadores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.observations.map((o) => (
                      <tr key={o.observedOn} className="border-t border-border">
                        <td className="py-1 pr-3 whitespace-nowrap">{formatDate(o.observedOn)}</td>
                        <td className="py-1 pr-3">{o.rank ? `${o.rank}º` : "—"}</td>
                        <td className="py-1">
                          {o.metrics
                            .filter((m) => m.key !== "rank")
                            .map((m) => `${m.label}: ${m.value}`)
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section
          aria-labelledby="inferred"
          className="grid content-start gap-3 rounded-xl border border-dashed border-accent/40 bg-accent-soft/10 p-4"
        >
          <h2 id="inferred" className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-accent-text" /> Análise da IA (inferência)
            {c?.demo ? <Badge tone="warning">Demonstração</Badge> : null}
          </h2>
          {c ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                {[
                  ["Tipo", type ? (TREND_TYPES[type as keyof typeof TREND_TYPES] ?? type) : "—"],
                  ["Relevância", lv(c.relevance)],
                  ["Interesse do público", lv(c.audienceInterest)],
                  ["Risco de reputação", risk(c.reputationRisk)],
                  ["Sensibilidade", lv(c.sensitivity)],
                  [
                    "Tempo de relevância",
                    c.lifespan ? (LIFESPANS[c.lifespan as keyof typeof LIFESPANS] ?? c.lifespan) : "—",
                  ],
                  ["Confiança", lv(c.confidence)],
                  ["Nicho sugerido", nicheLabel(c.suggestedNiche)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-fg-muted">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              {c.velocity ? (
                <p className="text-xs">
                  <span className="text-fg-muted">Velocidade:</span> {c.velocity}
                </p>
              ) : null}
              {c.nicheFit ? (
                <p className="text-xs">
                  <span className="text-fg-muted">Relação com o nicho:</span> {c.nicheFit}
                </p>
              ) : null}
              {c.saturation ? (
                <p className="text-xs">
                  <span className="text-fg-muted">Saturação:</span> {c.saturation}
                </p>
              ) : null}
              {c.angles.length ? (
                <div className="text-xs">
                  <p className="text-fg-muted">Ângulos de conteúdo</p>
                  <ul className="list-inside list-disc">
                    {c.angles.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {c.avoid.length ? (
                <p className="text-xs">
                  <span className="text-fg-muted">Evitar:</span> {c.avoid.join(" · ")}
                </p>
              ) : null}
              {c.rationale ? <p className="text-xs text-fg-muted">{c.rationale}</p> : null}
              {c.guardrails.length ? (
                <ul className="grid gap-0.5 text-[11px] text-fg-subtle">
                  {c.guardrails.map((g) => (
                    <li key={g}>Regra do sistema: {g}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[11px] text-fg-subtle">
                {c.provider} · {c.model} · {formatDateTime(c.createdAt)}
              </p>
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              {t.platform === "calendar" ? "Data sazonal (regra do sistema). " : ""}Ainda não classificada pela IA. Use
              “Classificar com IA” no Radar.
            </p>
          )}

          <div className="grid gap-2 border-t border-border pt-3">
            <h3 className="text-xs font-medium text-fg-muted">Análises por cliente</h3>
            {fits.length ? (
              <ul className="grid gap-2">
                {fits.map(({ analysis: a, clientName }) => (
                  <li key={a.id} className="text-xs">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{clientName}</span>
                      <Badge tone={a.recommended ? "success" : "danger"}>
                        {a.recommended ? "Combina" : "Não recomendado"}
                      </Badge>
                      <span className="text-fg-subtle">Risco {risk(a.reputationRisk)}</span>
                      {a.demo ? <Badge tone="warning">Demonstração</Badge> : null}
                    </p>
                    {a.rationale ? <p className="mt-0.5 text-fg-muted">{a.rationale}</p> : null}
                    {a.avoid.length ? <p className="text-fg-subtle">Evitar: {a.avoid.join(" · ")}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-subtle">Pergunte no Radar quais tendências combinam com um cliente.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
