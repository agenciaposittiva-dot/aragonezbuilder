/*
 * Formatação com locale e fuso fixos, para que servidor e navegador produzam
 * exatamente o mesmo texto (sem erro de hidratação).
 */
const TZ = "America/Sao_Paulo";
const LOCALE = "pt-BR";

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "2-digit", timeZone: TZ });

/** Datas "YYYY-MM-DD" (colunas date) são interpretadas como meio-dia UTC para não mudar de dia. */
function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(toDate(value)).replace(" de ", " ").replace(".", "");
}

export function formatShortDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return shortDateFmt.format(toDate(value)).replace(" de ", " ").replace(".", "");
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(toDate(value)).replace(" de ", " ").replace(".", "");
}

export function formatMonth(value: Date | string): string {
  return monthFmt.format(toDate(value)).replace(" de ", " ").replace(".", "");
}

const currencyFmt = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "BRL" });
const compactCurrencyFmt = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(cents: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "—";
  return (opts.compact ? compactCurrencyFmt : currencyFmt).format(cents / 100);
}

const numberFmt = new Intl.NumberFormat(LOCALE);
export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

export function formatPercent(ratio: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: digits }).format(ratio);
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace(".", ",")} ${units[i]}`;
}

/** Data de hoje (YYYY-MM-DD) no fuso da agência. */
export function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

export function relativeFromNow(value: Date | string): string {
  const date = toDate(value);
  const diff = (date.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return "agora";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(date);
}

export const PRIORITY_LABEL: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};
