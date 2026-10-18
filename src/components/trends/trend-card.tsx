"use client";

import {
  Bookmark,
  CalendarDays,
  Eye,
  EyeOff,
  ExternalLink,
  FolderPlus,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate, relativeFromNow } from "@/lib/format";
import { LEVELS, nicheLabel, RISK_LEVELS, TREND_PLATFORMS, TREND_TYPES, type TrendPlatform } from "@/lib/trends";
import { cn } from "@/lib/utils";
import { setCollectionMembershipAction, setTrendStateAction } from "@/server/actions/trends";
import type { TrendMetric, TrendRelated } from "@/server/db/schema";

export type TrendCardData = {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  platform: string;
  niche: string | null;
  region: string | null;
  language: string | null;
  publishedAt: Date | string | null;
  eventDate: string | null;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  metrics: TrendMetric[];
  related: TrendRelated[];
  sourceName: string;
  type: string | null;
  classification: {
    trendType: string | null;
    relevance: string | null;
    confidence: string | null;
    reputationRisk: string | null;
    angles: string[];
    demo: boolean;
    createdAt: string;
  } | null;
  state: { saved: boolean; favorite: boolean; following: boolean; dismissed: boolean } | null;
  fitClients: { id: string; name: string }[];
  collectionIds: string[];
  growth: { growing: boolean | null; notes: string[] };
};

type StateKey = "saved" | "favorite" | "following" | "dismissed";

/** Rótulos de nível/risco vindos da IA (sempre mostrados como inferência). */
function level(v: string | null | undefined) {
  return v ? (LEVELS[v as keyof typeof LEVELS] ?? v) : "—";
}

export function TrendStateButtons({
  trendId,
  state,
  compact,
}: {
  trendId: string;
  state: TrendCardData["state"];
  compact?: boolean;
}) {
  const action = useOrgAction(setTrendStateAction);
  const s = state ?? { saved: false, favorite: false, following: false, dismissed: false };
  const items: { key: StateKey; on: string; off: string; icon: React.ReactNode }[] = [
    { key: "saved", on: "Salva", off: "Salvar", icon: <Bookmark className={cn(s.saved && "fill-current")} /> },
    { key: "favorite", on: "Favorita", off: "Favoritar", icon: <Star className={cn(s.favorite && "fill-current")} /> },
    { key: "following", on: "Acompanhando", off: "Acompanhar", icon: <Eye /> },
    { key: "dismissed", on: "Descartada", off: "Descartar", icon: <EyeOff /> },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((it) => (
        <Button
          key={it.key}
          type="button"
          variant="ghost"
          size={compact ? "icon-xs" : "xs"}
          aria-pressed={s[it.key]}
          aria-label={s[it.key] ? `${it.on} (desfazer)` : it.off}
          title={s[it.key] ? `${it.on} — clique para desfazer` : it.off}
          disabled={action.pending}
          className={cn(s[it.key] && "text-accent-text")}
          onClick={() => action.run({ trendId, [it.key]: !s[it.key] })}
        >
          {it.icon}
          {compact ? null : <span>{s[it.key] ? it.on : it.off}</span>}
        </Button>
      ))}
    </div>
  );
}

export function CollectionMenu({
  trendId,
  collections,
  memberOf,
}: {
  trendId: string;
  collections: { id: string; name: string }[];
  memberOf: string[];
}) {
  const action = useOrgAction(setCollectionMembershipAction);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Adicionar a uma coleção" title="Coleções">
          <FolderPlus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Coleções</DropdownMenuLabel>
        {collections.length ? (
          collections.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={memberOf.includes(c.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(v) => action.run({ collectionId: c.id, trendId, member: !!v })}
            >
              {c.name}
            </DropdownMenuCheckboxItem>
          ))
        ) : (
          <p className="px-2 py-1.5 text-xs text-fg-muted">Crie uma coleção na barra lateral do Radar.</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Indicadores exatamente como a fonte informa (nada é estimado aqui). */
export function ObservedMetrics({ metrics }: { metrics: TrendMetric[] }) {
  if (!metrics.length) {
    return <p className="text-xs text-fg-subtle">A fonte não informa números de popularidade para este item.</p>;
  }
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {metrics.map((m) => (
        <div key={m.key} className="flex gap-1">
          <dt className="text-fg-muted">{m.label}:</dt>
          <dd className="font-medium text-fg tabular-nums">
            {m.value}
            {m.asOf ? <span className="font-normal text-fg-subtle"> ({formatDate(m.asOf)})</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TrendCard({
  base,
  trend,
  collections,
}: {
  base: string;
  trend: TrendCardData;
  collections: { id: string; name: string }[];
}) {
  const c = trend.classification;
  const type = trend.type ? (TREND_TYPES[trend.type as keyof typeof TREND_TYPES] ?? trend.type) : null;
  return (
    <article
      data-testid="trend-card"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="outline">{TREND_PLATFORMS[trend.platform as TrendPlatform] ?? trend.platform}</Badge>
            {trend.niche ? <Badge>{nicheLabel(trend.niche)}</Badge> : null}
            {trend.region ? <Badge tone="outline">{trend.region}</Badge> : null}
          </div>
          <h3 className="text-[15px] leading-snug font-semibold">
            <Link href={`${base}/${trend.id}`} className="hover:underline">
              {trend.title}
            </Link>
          </h3>
        </div>
        <CollectionMenu trendId={trend.id} collections={collections} memberOf={trend.collectionIds} />
      </header>

      {/* Observado: o que a fonte informa */}
      <section aria-label="Dados observados na fonte" className="grid gap-1.5">
        {trend.summary ? <p className="line-clamp-3 text-sm text-fg-muted">{trend.summary}</p> : null}
        <ObservedMetrics metrics={trend.metrics} />
        {trend.growth.notes.length ? (
          <p className="flex items-start gap-1 text-xs text-fg-muted">
            {trend.growth.growing ? (
              <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : (
              <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
            )}
            {trend.growth.notes[0]}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
          {trend.eventDate ? (
            <span className="inline-flex items-center gap-1 font-medium text-fg-muted">
              <CalendarDays className="size-3" /> {formatDate(trend.eventDate)}
            </span>
          ) : null}
          <span>Fonte: {trend.sourceName}</span>
          {trend.publishedAt ? <span>Publicado {formatDate(trend.publishedAt)}</span> : null}
          <span>Visto pela 1ª vez {formatDate(trend.firstSeenAt)}</span>
          <span>Atualizado {relativeFromNow(trend.lastSeenAt)}</span>
          {trend.url ? (
            <a
              href={trend.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-fg"
            >
              Abrir fonte <ExternalLink className="size-3" />
            </a>
          ) : null}
        </p>
      </section>

      {/* Inferido: análise da IA, sempre identificada */}
      <section
        aria-label="Análise da IA (inferência)"
        className="grid gap-1.5 rounded-lg border border-dashed border-accent/40 bg-accent-soft/20 p-2.5"
      >
        <p className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-accent-text uppercase">
          <Sparkles className="size-3" /> Inferência {c?.demo ? "· demonstração" : "da IA"}
        </p>
        {c || type ? (
          <>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {type ? <Badge tone="accent">{type}</Badge> : null}
              {c ? (
                <>
                  <Badge tone="outline">Relevância: {level(c.relevance)}</Badge>
                  <Badge tone="outline">Confiança: {level(c.confidence)}</Badge>
                  {c.reputationRisk ? (
                    <Badge
                      tone={
                        c.reputationRisk === "alto" ? "danger" : c.reputationRisk === "medio" ? "warning" : "outline"
                      }
                    >
                      Risco: {RISK_LEVELS[c.reputationRisk as keyof typeof RISK_LEVELS] ?? c.reputationRisk}
                    </Badge>
                  ) : null}
                </>
              ) : null}
            </div>
            {c?.angles.length ? (
              <ul className="list-inside list-disc text-xs text-fg-muted">
                {c.angles.slice(0, 2).map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
            {!c ? <p className="text-xs text-fg-subtle">Ainda não classificada pela IA.</p> : null}
          </>
        ) : (
          <p className="text-xs text-fg-subtle">Ainda não classificada pela IA.</p>
        )}
        {trend.fitClients.length ? (
          <p className="text-xs text-fg-muted">
            Pode servir para:{" "}
            <span className="font-medium text-fg">{trend.fitClients.map((f) => f.name).join(", ")}</span>
          </p>
        ) : null}
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        <TrendStateButtons trendId={trend.id} state={trend.state} compact />
        <Button asChild variant="primary" size="xs">
          <Link href={`${base}/${trend.id}?create=1`}>
            <Wand2 /> Criar conteúdo
          </Link>
        </Button>
      </footer>
    </article>
  );
}
