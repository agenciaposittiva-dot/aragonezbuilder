import { Info } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMinutes, formatPercent, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  membershipId: string;
  name: string;
  image: string | null;
  jobTitle: string | null;
  roleName: string;
  capacity: number;
  plannedMinutes: number;
  dueSoon: number;
  withoutEstimate: number;
  overdue: number;
  open: number;
  load: number | null;
};

/** Carga de trabalho com definição explícita (sem julgamento automático de desempenho). */
export function WorkloadView({ from, to, rows }: { from: string; to: string; rows: Row[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-fg-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <p>
          <span className="font-medium text-fg">
            Carga = soma das estimativas das tarefas abertas com prazo nos próximos 7 dias ÷ capacidade semanal.
          </span>{" "}
          Período: {formatShortDate(from)} a {formatShortDate(to)}. Tarefas sem estimativa não entram na soma e aparecem
          à parte; tarefas atrasadas também são mostradas separadamente. O indicador serve para equilibrar a
          distribuição, não para avaliar desempenho.
        </p>
      </div>
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Pessoa</TH>
              <TH className="w-[40%]">Carga (próximos 7 dias)</TH>
              <TH className="hidden text-right sm:table-cell">Previsto</TH>
              <TH className="hidden text-right md:table-cell">Sem estimativa</TH>
              <TH className="text-right">Atrasadas</TH>
              <TH className="hidden text-right lg:table-cell">Abertas</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const pct = r.load ?? 0;
              const tone =
                r.load === null ? "bg-surface-3" : pct > 1 ? "bg-danger" : pct > 0.85 ? "bg-warning" : "bg-success";
              return (
                <TR key={r.membershipId}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.name} src={r.image} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.name}</p>
                        <p className="truncate text-xs text-fg-muted">{r.jobTitle ?? r.roleName}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {r.load === null ? (
                      <span className="text-xs text-fg-subtle">Capacidade não definida</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3"
                          role="img"
                          aria-label={`Carga ${formatPercent(pct)}`}
                        >
                          <div
                            className={cn("h-full rounded-full", tone)}
                            style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "tabular w-12 text-right text-xs",
                            pct > 1 ? "font-semibold text-danger" : "text-fg-muted",
                          )}
                        >
                          {formatPercent(pct)}
                        </span>
                      </div>
                    )}
                  </TD>
                  <TD className="tabular hidden text-right text-xs sm:table-cell">
                    {formatMinutes(r.plannedMinutes)} / {formatMinutes(r.capacity)}
                  </TD>
                  <TD className="tabular hidden text-right md:table-cell">{r.withoutEstimate}</TD>
                  <TD className={cn("tabular text-right", r.overdue ? "font-medium text-danger" : "")}>{r.overdue}</TD>
                  <TD className="tabular hidden text-right lg:table-cell">{r.open}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
