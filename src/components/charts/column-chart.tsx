"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatTick, formatValue, type ValueFormat } from "./format";

/*
 * Gráfico de colunas.
 * Paleta validada (scripts/validate_palette.js do skill de dataviz):
 *   claro  #b8860b (dourado, série principal) · #2a78d6
 *   escuro #c98500 · #3987e5
 * Marcas finas (≤ 24 px, ponta arredondada de 4 px), grade discreta, tooltip
 * com valor em destaque e tabela de dados sempre disponível.
 */

export type ChartSeries = { key: string; label: string };
export type ChartDatum = { label: string } & Record<string, number | string>;

const SERIES_VARS = ["var(--series-1)", "var(--series-2)"];

const paletteClass = "[--series-1:#b8860b] [--series-2:#2a78d6] dark:[--series-1:#c98500] dark:[--series-2:#3987e5]";

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: TooltipContentProps<number, string> & { format: ValueFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border border-border bg-surface px-3 py-2 shadow-md">
      <p className="mb-1 text-xs text-fg-muted">{label}</p>
      <ul className="grid gap-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2 text-sm">
            <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            <span className="tabular font-semibold text-fg">{formatValue(Number(p.value ?? 0), format)}</span>
            <span className="text-xs text-fg-muted">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ColumnChart({
  data,
  series,
  format = "number",
  height = 240,
  title,
  className,
}: {
  data: ChartDatum[];
  series: ChartSeries[];
  format?: ValueFormat;
  height?: number;
  /** Nome usado na tabela de dados (acessibilidade). */
  title: string;
  className?: string;
}) {
  const multi = series.length > 1;
  return (
    <figure className={cn(paletteClass, "grid gap-3", className)}>
      {multi ? (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          {series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: SERIES_VARS[i] }} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </figcaption>
      ) : (
        <figcaption className="sr-only">{title}</figcaption>
      )}
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--fg-subtle)", fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={format === "money" || format === "money-compact" ? 72 : 48}
              tick={{ fill: "var(--fg-subtle)", fontSize: 11 }}
              tickFormatter={(v: number) => formatTick(v, format)}
              allowDecimals={format !== "number"}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} format={format} />}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={SERIES_VARS[i]}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-xs text-fg-muted">
        <summary className="w-fit cursor-pointer select-none hover:text-fg">Ver dados em tabela</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Período</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1.5 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3">{d.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="tabular py-1.5 pr-3 text-right text-fg">
                      {formatValue(Number(d[s.key] ?? 0), format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
