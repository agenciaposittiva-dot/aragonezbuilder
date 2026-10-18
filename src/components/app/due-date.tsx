import { CalendarDays } from "lucide-react";
import { formatShortDate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Prazo com destaque para atrasado / hoje. */
export function DueDate({
  date,
  done,
  className,
  icon = true,
}: {
  date: string | null;
  done?: boolean;
  className?: string;
  icon?: boolean;
}) {
  if (!date) return <span className={cn("text-xs text-fg-subtle", className)}>—</span>;
  const today = todayISO();
  const overdue = !done && date < today;
  const isToday = !done && date === today;
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 text-xs",
        overdue ? "font-medium text-danger" : isToday ? "font-medium text-warning" : "text-fg-muted",
        className,
      )}
      title={overdue ? "Atrasado" : isToday ? "Vence hoje" : undefined}
    >
      {icon ? <CalendarDays className="size-3.5" aria-hidden="true" /> : null}
      {isToday ? "Hoje" : formatShortDate(date)}
    </span>
  );
}
