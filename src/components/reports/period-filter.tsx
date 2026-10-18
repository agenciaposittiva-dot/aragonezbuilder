"use client";

import { DateFilter, SelectFilter } from "@/components/app/filters";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRESETS = [
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "12 meses" },
];

function minusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Filtros do relatório: período (atalhos primeiro), intervalo e cliente. */
export function ReportFilters({
  from,
  to,
  clients,
}: {
  from: string;
  to: string;
  clients: { id: string; name: string }[];
}) {
  const { set } = useSearchParamsState();
  const today = todayISO();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5">
        {PRESETS.map((p) => {
          const pFrom = minusDays(today, p.days - 1);
          const active = to === today && from === pFrom;
          return (
            <button
              key={p.days}
              type="button"
              onClick={() => set({ from: pFrom, to: today })}
              className={cn(
                "h-7 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap text-fg-muted transition-colors hover:text-fg",
                active && "bg-surface text-fg shadow-xs",
              )}
              aria-pressed={active}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <DateFilter param="from" label="De" />
      <DateFilter param="to" label="até" />
      <SelectFilter
        param="clientId"
        label="Todos os clientes"
        options={clients.map((c) => ({ value: c.id, label: c.name }))}
      />
    </div>
  );
}
