import { formatMinutes, formatMoney, formatNumber, formatPercent } from "@/lib/format";

/** Formatos serializáveis (podem vir de Server Components). */
export type ValueFormat = "number" | "money" | "money-compact" | "percent" | "minutes" | "hours";

export function formatValue(value: number, format: ValueFormat): string {
  switch (format) {
    case "money":
      return formatMoney(value);
    case "money-compact":
      return formatMoney(value, { compact: true });
    case "percent":
      return formatPercent(value, 0);
    case "minutes":
      return formatMinutes(value);
    case "hours":
      return `${formatNumber(Math.round(value * 10) / 10)} h`;
    default:
      return formatNumber(value);
  }
}

/** Ticks do eixo: compactos a partir de mil. */
export function formatTick(value: number, format: ValueFormat): string {
  if (format === "money" || format === "money-compact") return formatMoney(value, { compact: true });
  if (format === "percent") return formatPercent(value, 0);
  if (format === "minutes") return `${Math.round(value / 60)}h`;
  if (Math.abs(value) >= 1000)
    return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return formatNumber(value);
}
