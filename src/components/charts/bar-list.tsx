import { cn } from "@/lib/utils";
import { formatValue, type ValueFormat } from "./format";

/**
 * Barras horizontais em HTML para comparar categorias (uma série, cor da série
 * principal). O valor fica rotulado na ponta: a leitura não depende de hover.
 */
export function BarList({
  items,
  format = "number",
  emptyLabel = "Sem dados no período.",
  className,
}: {
  items: { label: string; value: number; hint?: string }[];
  format?: ValueFormat;
  emptyLabel?: string;
  className?: string;
}) {
  if (!items.length) return <p className="text-sm text-fg-muted">{emptyLabel}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className={cn("grid gap-2.5 [--series-1:#b8860b] dark:[--series-1:#c98500]", className)}>
      {items.map((it) => (
        <li
          key={it.label}
          className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]"
        >
          <span className="truncate text-fg-muted" title={it.label}>
            {it.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-r bg-surface-2" aria-hidden="true">
            <span
              className="block h-full rounded-r-[4px] bg-[var(--series-1)]"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
            />
          </span>
          <span className="tabular text-right font-medium text-fg">
            {formatValue(it.value, format)}
            {it.hint ? <span className="ml-1 text-xs font-normal text-fg-subtle">{it.hint}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Medidor de proporção com trilho do mesmo tom. */
export function Meter({ ratio, tone, label }: { ratio: number; tone?: "warning" | "danger"; label: string }) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <span className="flex items-center gap-2" title={label}>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-accent-soft" aria-hidden="true">
        <span
          className={cn(
            "block h-full rounded-full",
            tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-accent",
          )}
          style={{ width: `${pct * 100}%` }}
        />
      </span>
      <span className="tabular text-xs text-fg-muted">{label}</span>
    </span>
  );
}
