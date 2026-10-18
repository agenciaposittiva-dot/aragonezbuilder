"use client";

import { Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate, formatMinutes, formatMoney, todayISO } from "@/lib/format";
import { parseDuration } from "@/lib/validators/tasks";
import { addTimeEntryAction, deleteTimeEntryAction, startTimerAction, stopTimerAction } from "@/server/actions/tasks";

type Entry = {
  id: string;
  membershipId: string;
  startedAt: Date;
  endedAt: Date | null;
  minutes: number;
  note: string | null;
  costCents: number | null;
  name: string;
  image: string | null;
};

function useElapsed(startedAt: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return null;
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

/** Cronômetro, lançamento manual e lista de registros de tempo da tarefa. */
export function TaskTime({
  taskId,
  entries,
  runningHere,
  runningElsewhere,
  canTrack,
  trackingEnabled,
}: {
  taskId: string;
  entries: Entry[];
  runningHere: { startedAt: Date } | null;
  runningElsewhere: { taskTitle: string } | null;
  canTrack: boolean;
  trackingEnabled: boolean;
}) {
  const { membershipId, permissions } = useWorkspace();
  const elapsed = useElapsed(runningHere?.startedAt ?? null);
  const start = useOrgAction(startTimerAction);
  const stop = useOrgAction(stopTimerAction, { success: (d) => `Tempo registrado: ${formatMinutes(d.minutes)}` });
  const add = useOrgAction(addTimeEntryAction, { success: "Tempo registrado", onSuccess: () => setDuration("") });
  const remove = useOrgAction(deleteTimeEntryAction, { success: "Registro removido" });
  const [duration, setDuration] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isAdmin = permissions.includes("org.manage");
  const closed = entries.filter((e) => e.endedAt);
  const total = closed.reduce((acc, e) => acc + e.minutes, 0);

  if (!trackingEnabled) {
    return (
      <p className="text-sm text-fg-muted">O registro de tempo está desativado nas configurações da organização.</p>
    );
  }

  return (
    <div className="grid gap-4">
      {canTrack ? (
        <div className="flex flex-wrap items-center gap-3">
          {runningHere ? (
            <Button variant="danger" size="sm" onClick={() => stop.run({})} loading={stop.pending}>
              <Pause /> Parar · <span className="tabular">{elapsed}</span>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => start.run({ taskId })} loading={start.pending}>
              <Play /> Iniciar cronômetro
            </Button>
          )}
          {runningElsewhere && !runningHere ? (
            <p className="text-xs text-warning">
              Cronômetro ativo em “{runningElsewhere.taskTitle}”: ele será encerrado ao iniciar aqui.
            </p>
          ) : null}
        </div>
      ) : null}

      {canTrack ? (
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const minutes = parseDuration(duration);
            if (!minutes) {
              setError("Informe a duração (ex.: 1h30, 45min).");
              return;
            }
            setError(null);
            add.run({ taskId, date, minutes, note, billable: true });
            setNote("");
          }}
        >
          <Input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="1h30"
            aria-label="Duração"
            className="h-8"
          />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Data"
            className="h-8"
            max={todayISO()}
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="O que foi feito (opcional)"
            aria-label="Observação"
            className="col-span-2 h-8"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            loading={add.pending}
            className="col-span-2 justify-self-start"
          >
            Lançar
          </Button>
          {error ? <p className="col-span-2 text-xs text-danger">{error}</p> : null}
        </form>
      ) : null}

      {closed.length ? (
        <div>
          <p className="mb-2 text-xs text-fg-muted">Total registrado: {formatMinutes(total)}</p>
          <ul className="divide-y divide-border">
            {closed.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <Avatar name={e.name} src={e.image} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {e.name} · <span className="tabular">{formatMinutes(e.minutes)}</span>
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {formatDate(e.startedAt)}
                    {e.note ? ` · ${e.note}` : ""}
                  </span>
                </span>
                {e.costCents !== null ? (
                  <span className="tabular text-xs text-fg-subtle">{formatMoney(e.costCents)}</span>
                ) : null}
                {e.membershipId === membershipId || isAdmin ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Excluir registro"
                    onClick={() => remove.run({ id: e.id })}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Nenhum tempo registrado.</p>
      )}
    </div>
  );
}
