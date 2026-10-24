"use client";

import { AlertTriangle, ExternalLink, Flame, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Opportunity } from "@/lib/content-machine";
import { formatDate } from "@/lib/format";

/** Oportunidade: o que é fato coletado (fonte, link, data, evidência) fica separado do que a IA sugere. */
export function OpportunityCard({ o }: { o: Opportunity }) {
  return (
    <div
      data-testid="machine-opportunity"
      className="grid gap-3 rounded-lg border border-border bg-surface-2/30 p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        {o.evidence === "trending" ? (
          <Badge tone="success">
            <Flame /> Em alta (dados do Radar)
          </Badge>
        ) : (
          <Badge tone="warning">
            <Lightbulb /> Hipótese editorial
          </Badge>
        )}
        {o.provisional ? <Badge tone="outline">Proposta provisória</Badge> : null}
        {o.demo ? <Badge tone="info">Demonstração</Badge> : null}
      </div>
      <div>
        <p className="text-base font-semibold">{o.title}</p>
        <p className="mt-1 text-fg-muted">{o.evidenceNote}</p>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-xs text-fg-muted sm:grid-cols-2">
        <div>
          <dt className="inline">Fonte: </dt>
          <dd className="inline text-fg">
            {o.sourceUrl ? (
              <a
                href={o.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {o.sourceName ?? o.sourceUrl} <ExternalLink className="size-3" />
              </a>
            ) : (
              (o.sourceName ?? "—")
            )}
          </dd>
        </div>
        <div>
          <dt className="inline">{o.dateKind === "published" ? "Publicado em: " : "Coletado em: "}</dt>
          <dd className="inline text-fg">{o.date ? formatDate(o.date) : "sem data informada"}</dd>
        </div>
      </dl>
      {o.summary ? (
        <div>
          <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Resumo</p>
          <p className="mt-1">{o.summary}</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {o.relevance ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Por que pode ser relevante</p>
            <p className="mt-1">{o.relevance}</p>
          </div>
        ) : null}
        {o.nicheRelation ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Relação com a marca</p>
            <p className="mt-1">{o.nicheRelation}</p>
          </div>
        ) : null}
      </div>
      {o.angleHints.length ? (
        <div>
          <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Caminhos editoriais</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {o.angleHints.map((h) => (
              <li key={h}>
                <Badge tone="neutral">{h}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {o.risks.length ? (
        <div className="rounded-md bg-warning-soft/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" /> Riscos e o que confirmar
          </p>
          <ul className="mt-1 list-disc pl-5">
            {o.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {o.model ? <p className="text-[11px] text-fg-subtle">Síntese por {o.model}</p> : null}
    </div>
  );
}
