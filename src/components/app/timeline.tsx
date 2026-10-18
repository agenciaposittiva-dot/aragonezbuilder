import Link from "next/link";
import { STATUS_COLORS } from "@/components/ui/badge";
import { formatShortDate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineRow = {
  id: string;
  title: string;
  subtitle?: string;
  start: string | null;
  end: string | null;
  color: string;
  href: string;
  progress?: number;
};

const DAY = 86_400_000;
const toTime = (d: string) => new Date(`${d}T12:00:00Z`).getTime();

/** Linha do tempo (Gantt simplificado) por semanas. Itens sem datas ficam listados à parte. */
export function Timeline({ rows }: { rows: TimelineRow[] }) {
  const dated = rows.filter((r) => r.start || r.end);
  const undated = rows.filter((r) => !r.start && !r.end);
  if (!dated.length) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-fg-muted">
        Defina datas de início e prazo para ver a linha do tempo.
      </div>
    );
  }
  const today = todayISO();
  const starts = dated.map((r) => toTime(r.start ?? r.end!));
  const ends = dated.map((r) => toTime(r.end ?? r.start!));
  let min = Math.min(...starts, toTime(today)) - 3 * DAY;
  let max = Math.max(...ends, toTime(today)) + 7 * DAY;
  // Alinha ao domingo
  min -= new Date(min).getUTCDay() * DAY;
  max += (6 - new Date(max).getUTCDay()) * DAY;
  const span = max - min;
  const weeks: number[] = [];
  for (let t = min; t <= max; t += 7 * DAY) weeks.push(t);
  const pct = (t: number) => ((t - min) / span) * 100;
  const todayPct = pct(toTime(today));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <div className="scrollbar-thin overflow-x-auto">
        <div style={{ minWidth: Math.max(720, weeks.length * 72) + 240 }}>
          <div className="flex border-b border-border bg-surface-2/50 text-[11px] text-fg-subtle">
            <div className="w-60 shrink-0 px-4 py-2 font-medium">Item</div>
            <div className="relative flex-1">
              {weeks.map((w) => (
                <span
                  key={w}
                  className="absolute top-2 -translate-x-0 pl-1 whitespace-nowrap"
                  style={{ left: `${pct(w)}%` }}
                >
                  {formatShortDate(new Date(w))}
                </span>
              ))}
            </div>
          </div>
          <ul>
            {dated.map((r) => {
              const s = toTime(r.start ?? r.end!);
              const e = toTime(r.end ?? r.start!) + DAY;
              const c = STATUS_COLORS[r.color] ?? STATUS_COLORS.slate!;
              return (
                <li key={r.id} className="flex border-b border-border last:border-0 hover:bg-surface-2/40">
                  <Link href={r.href} className="w-60 shrink-0 truncate px-4 py-2.5 text-sm hover:underline">
                    <span className="block truncate font-medium">{r.title}</span>
                    {r.subtitle ? <span className="block truncate text-xs text-fg-muted">{r.subtitle}</span> : null}
                  </Link>
                  <div className="relative flex-1">
                    {weeks.map((w) => (
                      <span
                        key={w}
                        className="absolute inset-y-0 w-px bg-border/60"
                        style={{ left: `${pct(w)}%` }}
                        aria-hidden="true"
                      />
                    ))}
                    <span
                      className="absolute inset-y-0 w-0.5 bg-accent/70"
                      style={{ left: `${todayPct}%` }}
                      aria-hidden="true"
                    />
                    <Link
                      href={r.href}
                      className={cn(
                        "absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden rounded-md px-2 text-[11px] font-medium",
                        c.badge,
                      )}
                      style={{ left: `${pct(s)}%`, width: `max(${pct(e) - pct(s)}%, 8px)` }}
                      title={`${r.title}: ${r.start ? formatShortDate(r.start) : "?"} → ${r.end ? formatShortDate(r.end) : "?"}`}
                    >
                      {typeof r.progress === "number" ? (
                        <span
                          className={cn("absolute inset-y-0 left-0 opacity-25", c.dot)}
                          style={{ width: `${Math.round(r.progress * 100)}%` }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="relative truncate">{r.title}</span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {undated.length ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-fg-muted">
          Sem datas: {undated.map((u) => u.title).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
