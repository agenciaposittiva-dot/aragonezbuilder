import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { StatusDot } from "@/components/ui/badge";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  color: string;
  href: string;
  done?: boolean;
  subtitle?: string;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendário mensal (renderizado no servidor; navegação por ?month=YYYY-MM). */
export function MonthCalendar({
  month,
  events,
  hrefForMonth,
}: {
  /** YYYY-MM */
  month: string;
  events: CalendarEvent[];
  hrefForMonth: (month: string) => string;
}) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startWeekday = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const today = todayISO();
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold">
          {MONTHS[m - 1]} {y}
        </h3>
        <div className="flex items-center gap-1">
          <Link
            href={hrefForMonth(prev)}
            className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            href={hrefForMonth(today.slice(0, 7))}
            className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-2"
          >
            Hoje
          </Link>
          <Link
            href={hrefForMonth(next)}
            className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2"
            aria-label="Próximo mês"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-surface-2/50 text-center text-[11px] font-medium text-fg-subtle">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const date = day ? iso(y, m - 1, day) : null;
          const list = date ? (byDay.get(date) ?? []) : [];
          return (
            <div
              key={i}
              className={cn(
                "min-h-20 border-r border-b border-border p-1 sm:min-h-28 sm:p-1.5 [&:nth-child(7n)]:border-r-0",
                !day && "bg-surface-2/40",
              )}
            >
              {day ? (
                <>
                  <div
                    className={cn(
                      "tabular mb-1 flex size-6 items-center justify-center rounded-full text-xs",
                      date === today ? "bg-accent font-semibold text-accent-fg" : "text-fg-muted",
                    )}
                  >
                    {day}
                  </div>
                  <ul className="grid gap-0.5">
                    {list.slice(0, 3).map((e) => (
                      <li key={e.id}>
                        <Link
                          href={e.href}
                          title={e.subtitle ? `${e.title} · ${e.subtitle}` : e.title}
                          className={cn(
                            "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] hover:bg-surface-2",
                            e.done ? "text-fg-subtle line-through" : "text-fg",
                          )}
                        >
                          <StatusDot color={e.color} className="size-1.5" />
                          <span className="truncate">{e.title}</span>
                        </Link>
                      </li>
                    ))}
                    {list.length > 3 ? (
                      <li className="px-1 text-[11px] text-fg-subtle">+{list.length - 3} mais</li>
                    ) : null}
                  </ul>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
