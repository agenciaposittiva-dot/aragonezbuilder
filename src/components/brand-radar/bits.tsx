import { CircleHelp, Eye, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BASIS_LABEL,
  BRAND_DIMENSIONS,
  scoreTone,
  SOURCE_LABEL,
  type Basis,
  type DimensionResult,
  type Finding,
  type SourceKind,
} from "@/lib/brand-radar";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * Peças visuais do Radar de Marca (sem estado): base de cada afirmação,
 * nota, fonte/data e linhas das dimensões.
 */

const BASIS_TONE = { observed: "success", hypothesis: "info", insufficient: "neutral" } as const;
const BASIS_ICON = { observed: Eye, hypothesis: Lightbulb, insufficient: CircleHelp } as const;

export function BasisBadge({ basis }: { basis: Basis }) {
  const Icon = BASIS_ICON[basis] ?? Lightbulb;
  return (
    <Badge tone={BASIS_TONE[basis] ?? "neutral"} data-basis={basis}>
      <Icon aria-hidden="true" /> {BASIS_LABEL[basis] ?? basis}
    </Badge>
  );
}

export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "md" | "lg" }) {
  const tone = scoreTone(score);
  const color = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    neutral: "text-fg-subtle",
  }[tone];
  if (size === "lg") {
    return (
      <div className="flex items-baseline gap-1" aria-label={score === null ? "Sem nota" : `Nota ${score} de 100`}>
        <span className={cn("tabular text-4xl font-semibold tracking-tight", color)}>{score ?? "—"}</span>
        <span className="text-sm text-fg-subtle">/ 100</span>
      </div>
    );
  }
  return (
    <Badge tone={tone === "neutral" ? "neutral" : tone} className="tabular">
      {score === null ? "Sem nota" : `${score}/100`}
    </Badge>
  );
}

export function SourceLine({ source, collectedAt }: { source: SourceKind; collectedAt: string | Date }) {
  return (
    <span className="text-[11px] text-fg-subtle">
      {SOURCE_LABEL[source] ?? source}
      {source === "manual" ? " (não verificado)" : ""} · {formatDateTime(collectedAt)}
    </span>
  );
}

const STATUS_LABEL = { objective: "Regra objetiva", ai: "Avaliação da IA", not_evaluated: "Não avaliada" } as const;

export function DimensionRow({ d, weight }: { d: DimensionResult; weight: number }) {
  const def = BRAND_DIMENSIONS[d.key];
  const tone = scoreTone(d.score);
  const bar = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-surface-3" }[tone];
  return (
    <li className="grid gap-1 py-2.5" data-dimension={d.key} data-status={d.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{def?.label ?? d.key}</span>
        <span className="flex items-center gap-1.5">
          <Badge tone={d.status === "not_evaluated" ? "outline" : d.status === "ai" ? "info" : "accent"}>
            {STATUS_LABEL[d.status]}
          </Badge>
          <span className="tabular w-14 text-right text-sm font-semibold">{d.score === null ? "—" : `${d.score}`}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        {d.score !== null ? <div className={cn("h-full rounded-full", bar)} style={{ width: `${d.score}%` }} /> : null}
      </div>
      <p className="text-xs text-fg-muted">
        {d.rationale}
        {d.evidence ? <span className="text-fg-subtle"> · Evidência: {d.evidence}</span> : null}
      </p>
      <p className="text-[11px] text-fg-subtle">
        Peso {weight}
        {d.status === "not_evaluated" ? " · fora da nota" : ""}
      </p>
    </li>
  );
}

export function FindingList({ title, items, empty }: { title: string; items: Finding[]; empty: string }) {
  return (
    <div className="grid content-start gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
      {items.length ? (
        <ul className="grid gap-2">
          {items.map((f, i) => (
            <li key={i} className="grid gap-1 rounded-lg border border-border p-2.5">
              <span className="text-sm">{f.text}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <BasisBadge basis={f.basis} />
                {f.evidence ? <span className="text-xs text-fg-subtle">Evidência: {f.evidence}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-subtle">{empty}</p>
      )}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "grid min-w-0 content-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function GuardrailNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <details className="rounded-lg bg-surface-2/60 p-2.5 text-xs text-fg-muted">
      <summary className="cursor-pointer font-medium">Regras aplicadas pelo sistema ({notes.length})</summary>
      <ul className="mt-1.5 grid gap-0.5">
        {notes.map((n) => (
          <li key={n}>• {n}</li>
        ))}
      </ul>
    </details>
  );
}
