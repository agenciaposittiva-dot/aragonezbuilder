import { AlertTriangle, CheckCircle2, CircleSlash, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { RefreshTrendsButton } from "@/components/trends/trends-actions";
import { AddRssSourceDialog, DeleteSourceButton, SourceEnabledSwitch } from "@/components/trends/source-controls";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/lib/format";
import { nicheLabel } from "@/lib/trends";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listSources, MANUAL_INTERVAL_MIN } from "@/server/services/trends";

export const metadata: Metadata = { title: "Fontes do Radar" };
export const maxDuration = 60;

export default async function TrendSourcesPage({ params }: PageProps<"/w/[org]/trends/sources">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "trends.manage" });
  const sources = await inOrg(actor, (s) => listSources(s));
  const base = `/w/${actor.orgSlug}/trends`;

  return (
    <>
      <Breadcrumbs items={[{ label: "Radar de Tendências", href: base }, { label: "Fontes" }]} />
      <PageHeader
        title="Fontes do Radar"
        description={`Só fontes públicas e permitidas pelos próprios termos. A coleta automática roda junto da rotina diária; “Testar agora” coleta na hora (no máximo a cada ${MANUAL_INTERVAL_MIN} minutos por fonte).`}
        actions={
          <>
            <RefreshTrendsButton label="Atualizar todas" />
            <AddRssSourceDialog />
          </>
        }
      />
      <ul className="grid gap-3">
        {sources.map((x) => {
          const status = !x.enabled
            ? { icon: <CircleSlash className="size-4 text-fg-subtle" />, text: "Desativada" }
            : !x.available
              ? { icon: <AlertTriangle className="size-4 text-warning" />, text: x.unavailableReason ?? "Indisponível" }
              : x.lastError && (!x.lastSuccessAt || (x.lastRunAt && x.lastRunAt > x.lastSuccessAt))
                ? {
                    icon: <AlertTriangle className="size-4 text-danger" />,
                    text: `Erro na última tentativa: ${x.lastError}`,
                  }
                : x.lastSuccessAt
                  ? { icon: <CheckCircle2 className="size-4 text-success" />, text: "Funcionando" }
                  : { icon: <CircleSlash className="size-4 text-fg-subtle" />, text: "Ainda não coletada" };
          return (
            <li
              key={x.id}
              data-testid="trend-source"
              className="grid gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {x.name}
                    <Badge tone="outline">{x.info.label}</Badge>
                    {x.niche ? <Badge>{nicheLabel(x.niche)}</Badge> : null}
                    {x.isDefault ? <Badge tone="outline">Padrão</Badge> : null}
                  </h2>
                  <p className="mt-1 flex items-start gap-1.5 text-xs" data-testid="source-status">
                    {status.icon} <span>{status.text}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceEnabledSwitch id={x.id} enabled={x.enabled} name={x.name} />
                  {x.enabled && x.available ? <RefreshTrendsButton sourceId={x.id} label="Testar agora" /> : null}
                  {!x.isDefault ? <DeleteSourceButton id={x.id} name={x.name} /> : null}
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-fg-muted">Último sucesso</dt>
                  <dd>
                    {x.lastSuccessAt ? `${formatDateTime(x.lastSuccessAt)} · ${x.lastItemCount ?? 0} item(ns)` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Última tentativa</dt>
                  <dd>{x.lastRunAt ? formatDateTime(x.lastRunAt) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Itens no Radar</dt>
                  <dd>{x.items}</dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-fg-muted">Endereço consultado</dt>
                  <dd className="break-all">
                    {x.kind === "rss" ? String((x.config as { url?: string }).url ?? "") : x.info.endpoint}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Indicadores</dt>
                  <dd>{x.info.indicators}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Atualização</dt>
                  <dd>{x.info.freshness}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Limites</dt>
                  <dd>{x.info.limits}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Custo</dt>
                  <dd>{x.info.cost}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-fg-muted">Termos de uso</dt>
                  <dd>
                    {x.info.terms}{" "}
                    <a
                      href={x.info.docs}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-accent-text hover:underline"
                    >
                      Documentação <ExternalLink className="size-3" />
                    </a>
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
