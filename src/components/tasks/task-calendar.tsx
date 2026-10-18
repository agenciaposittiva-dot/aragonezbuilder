"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/badge";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { useOrgAction } from "@/hooks/use-action";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateTaskAction } from "@/server/actions/tasks";

export type CalendarMode = "month" | "week" | "day";

export type CalendarTask = {
  id: string;
  title: string;
  dueDate: string | null;
  statusColor: string;
  completedAt: Date | null;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  clientName: string;
  projectName: string;
};

/** A partir de quantas entregas abertas no mesmo dia uma pessoa fica sobrecarregada. */
export const OVERLOAD_THRESHOLD = 3;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekday(iso: string) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}
function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS[weekday(iso)]}, ${d} de ${MONTHS[m - 1]}${y !== Number(todayISO().slice(0, 4)) ? ` de ${y}` : ""}`;
}

/** Pessoas com entregas demais no dia (só tarefas abertas). */
function overloadOf(tasks: CalendarTask[]) {
  const byPerson = new Map<string, { name: string; count: number }>();
  for (const t of tasks) {
    if (t.completedAt || !t.assigneeMembershipId) continue;
    const cur = byPerson.get(t.assigneeMembershipId) ?? { name: t.assigneeName ?? "—", count: 0 };
    cur.count++;
    byPerson.set(t.assigneeMembershipId, cur);
  }
  return [...byPerson.values()].filter((p) => p.count >= OVERLOAD_THRESHOLD);
}

/**
 * Calendário de prazos (dia, semana, mês). Arrastar uma tarefa para outro dia
 * muda o prazo na hora e desfaz se o servidor recusar; tarefas sem prazo
 * ficam numa bandeja para serem planejadas. Dias em que alguém tem entregas
 * demais aparecem sinalizados.
 */
export function TaskCalendar({
  mode,
  anchor,
  from,
  to,
  rows,
  unscheduled = [],
  base,
  canWrite,
}: {
  mode: CalendarMode;
  /** Mês: primeiro dia; semana: domingo; dia: a própria data. */
  anchor: string;
  from: string;
  to: string;
  rows: CalendarTask[];
  unscheduled?: CalendarTask[];
  base: string;
  canWrite: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const update = useOrgAction(updateTaskAction);
  const dndId = useId();
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [dragging, setDragging] = useState<CalendarTask | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const all = useMemo(() => {
    const merged = new Map<string, CalendarTask>();
    for (const t of [...rows, ...unscheduled]) merged.set(t.id, t);
    return [...merged.values()].map((t) => (t.id in overrides ? { ...t, dueDate: overrides[t.id]! } : t));
  }, [rows, unscheduled, overrides]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const t of all) if (t.dueDate) map.set(t.dueDate, [...(map.get(t.dueDate) ?? []), t]);
    return map;
  }, [all]);
  const tray = all.filter((t) => !t.dueDate && !t.completedAt);

  const href = (next: Record<string, string | null>) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) qs.delete(k);
      else qs.set(k, v);
    }
    return `${pathname}?${qs.toString()}`;
  };
  const navFor = (m: CalendarMode, date: string) =>
    m === "month" ? href({ cal: null, date: null, month: date.slice(0, 7) }) : href({ cal: m, date, month: null });
  const step = mode === "day" ? 1 : mode === "week" ? 7 : 0;
  const prevMonth = (() => {
    const [y, m] = anchor.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  })();
  const nextMonth = plusDays(to, 1);
  const prev = mode === "month" ? prevMonth : plusDays(anchor, -step);
  const next = mode === "month" ? nextMonth : plusDays(anchor, step);
  const today = todayISO();
  const title =
    mode === "month"
      ? `${MONTHS[Number(anchor.slice(5, 7)) - 1]} de ${anchor.slice(0, 4)}`
      : mode === "week"
        ? `${dayLabel(from)} – ${dayLabel(to)}`
        : dayLabel(anchor);

  async function moveTo(task: CalendarTask, date: string | null) {
    if (task.dueDate === date) return;
    setOverrides((o) => ({ ...o, [task.id]: date }));
    const res = await update.run({ id: task.id, dueDate: date });
    if (!res.ok)
      setOverrides((o) => {
        const rest = { ...o };
        delete rest[task.id];
        return rest;
      });
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(all.find((t) => t.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const task = all.find((t) => t.id === e.active.id);
    const target = e.over?.id;
    if (!task || typeof target !== "string") return;
    void moveTo(task, target === "sem-prazo" ? null : target);
  }

  const days =
    mode === "month"
      ? (() => {
          const cells: (string | null)[] = Array(weekday(from)).fill(null);
          for (let d = from; d <= to; d = plusDays(d, 1)) cells.push(d);
          while (cells.length % 7) cells.push(null);
          return cells;
        })()
      : mode === "week"
        ? Array.from({ length: 7 }, (_, i) => plusDays(from, i))
        : [anchor];

  return (
    <DndContext id={dndId} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid gap-4">
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold first-letter:uppercase">{title}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedNav
                param="cal"
                items={[
                  // Sem ?cal= na URL vale o primeiro item (mês).
                  { label: "Mês", value: "month", href: navFor("month", mode === "month" ? anchor : today) },
                  { label: "Semana", value: "week", href: navFor("week", mode === "week" ? anchor : today) },
                  { label: "Dia", value: "day", href: navFor("day", mode === "day" ? anchor : today) },
                ]}
              />
              <div className="flex items-center gap-1">
                <Link
                  href={navFor(mode, prev)}
                  className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2"
                  aria-label="Anterior"
                >
                  <ChevronLeft className="size-4" />
                </Link>
                <Link
                  href={navFor(mode, today)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-2"
                >
                  Hoje
                </Link>
                <Link
                  href={navFor(mode, next)}
                  className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2"
                  aria-label="Próximo"
                >
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            </div>
          </div>

          {mode === "month" ? (
            <div className="grid grid-cols-7 border-b border-border bg-surface-2/50 text-center text-[11px] font-medium text-fg-subtle">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1.5">
                  {d}
                </div>
              ))}
            </div>
          ) : null}

          <div
            className={cn(
              mode === "month" && "grid grid-cols-7",
              mode === "week" && "grid grid-cols-1 divide-y divide-border md:grid-cols-7 md:divide-x md:divide-y-0",
            )}
          >
            {days.map((date, i) =>
              date ? (
                <DayCell
                  key={date}
                  date={date}
                  mode={mode}
                  today={today}
                  tasks={byDay.get(date) ?? []}
                  base={base}
                  canWrite={canWrite}
                  dayHref={navFor("day", date)}
                  onMove={moveTo}
                />
              ) : (
                <div
                  key={`vazio-${i}`}
                  className="min-h-20 border-r border-b border-border bg-surface-2/40 sm:min-h-28 [&:nth-child(7n)]:border-r-0"
                />
              ),
            )}
          </div>
        </div>

        {canWrite && mode !== "day" ? <UnscheduledTray tasks={tray} base={base} /> : null}
      </div>
      <DragOverlay>{dragging ? <Chip task={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function DayCell({
  date,
  mode,
  today,
  tasks,
  base,
  canWrite,
  dayHref,
  onMove,
}: {
  date: string;
  mode: CalendarMode;
  today: string;
  tasks: CalendarTask[];
  base: string;
  canWrite: boolean;
  dayHref: string;
  onMove: (task: CalendarTask, date: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !canWrite });
  const overload = overloadOf(tasks);
  const limit = mode === "month" ? 3 : Infinity;
  const shown = tasks.slice(0, limit);
  const day = Number(date.slice(8, 10));

  if (mode === "day") {
    const people = new Map<string, { name: string; image: string | null; tasks: CalendarTask[] }>();
    for (const t of tasks) {
      const key = t.assigneeMembershipId ?? "none";
      const cur = people.get(key) ?? { name: t.assigneeName ?? "Sem responsável", image: t.assigneeImage, tasks: [] };
      cur.tasks.push(t);
      people.set(key, cur);
    }
    return (
      <div ref={setNodeRef} className={cn("grid gap-4 p-4", isOver && "bg-accent/5")}>
        {overload.length ? <OverloadNote people={overload} /> : null}
        {tasks.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhuma entrega com prazo neste dia.</p>
        ) : (
          [...people.entries()].map(([key, p]) => (
            <section key={key} aria-label={p.name}>
              <h4 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-fg-muted">
                {key === "none" ? null : <Avatar name={p.name} src={p.image} size="xs" />}
                {p.name}
                <span className="font-normal text-fg-subtle">
                  {p.tasks.length} {p.tasks.length === 1 ? "entrega" : "entregas"}
                </span>
              </h4>
              <ul className="grid gap-1">
                {p.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Chip task={t} base={base} draggable={false} detailed />
                    </div>
                    {canWrite ? (
                      <label className="relative inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-2">
                        <CalendarClock className="size-3.5" /> Mudar prazo
                        <input
                          type="date"
                          aria-label={`Prazo de ${t.title}`}
                          value={t.dueDate ?? ""}
                          onChange={(e) => onMove(t, e.target.value || null)}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                      </label>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-date={date}
      aria-label={dayLabel(date)}
      className={cn(
        "min-w-0 p-1 sm:p-1.5",
        mode === "month" && "min-h-20 border-r border-b border-border sm:min-h-28 [&:nth-child(7n)]:border-r-0",
        mode === "week" && "min-h-24 md:min-h-72",
        isOver && "bg-accent/10",
      )}
    >
      <div className="mb-1 flex items-center gap-1">
        <Link
          href={dayHref}
          className={cn(
            "tabular flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs hover:bg-surface-2",
            date === today ? "bg-accent font-semibold text-accent-fg hover:bg-accent" : "text-fg-muted",
          )}
          aria-label={`Ver o dia ${dayLabel(date)}`}
        >
          {mode === "week" ? `${WEEKDAYS[weekday(date)]} ${day}` : day}
        </Link>
        {overload.length ? (
          <span
            className="inline-flex items-center text-warning"
            title={`Sobrecarga: ${overload.map((p) => `${p.name} (${p.count})`).join(", ")}`}
          >
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            <span className="sr-only">
              Sobrecarga: {overload.map((p) => `${p.name} (${p.count} entregas)`).join(", ")}
            </span>
          </span>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 gap-0.5">
        {shown.map((t) => (
          <li key={t.id}>
            <Chip task={t} base={base} draggable={canWrite} />
          </li>
        ))}
        {tasks.length > shown.length ? (
          <li>
            <Link href={dayHref} className="px-1 text-[11px] text-fg-subtle hover:underline">
              +{tasks.length - shown.length} mais
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function OverloadNote({ people }: { people: { name: string; count: number }[] }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Sobrecarga: {people.map((p) => `${p.name} tem ${p.count} entregas`).join("; ")}. Considere redistribuir ou mudar
        prazos.
      </span>
    </p>
  );
}

function Chip({
  task,
  base,
  draggable = true,
  overlay,
  detailed,
}: {
  task: CalendarTask;
  base?: string;
  draggable?: boolean;
  overlay?: boolean;
  detailed?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable || overlay,
  });
  const content = (
    <>
      <StatusDot color={task.statusColor} className="size-1.5" />
      <span className="truncate">{task.title}</span>
      {detailed ? (
        <span className="ml-1 hidden truncate text-fg-subtle sm:inline">
          · {task.clientName} · {task.projectName}
        </span>
      ) : null}
    </>
  );
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px]",
        detailed && "text-sm",
        task.completedAt ? "text-fg-subtle line-through" : "text-fg",
        isDragging && "opacity-40",
        overlay && "rounded-md border border-border bg-surface px-2 py-1 shadow-lg",
        !overlay && "hover:bg-surface-2",
      )}
      title={`${task.title} · ${task.clientName} · ${task.projectName}${task.assigneeName ? ` · ${task.assigneeName}` : ""}`}
    >
      {draggable && !overlay ? (
        <button
          type="button"
          className="-ml-0.5 hidden cursor-grab touch-none text-fg-subtle group-hover:inline-flex focus-visible:inline-flex"
          aria-label={`Arrastar ${task.title} para outro dia`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3" />
        </button>
      ) : null}
      {base && !overlay ? (
        <Link
          href={`${base}/tasks/${task.id}`}
          className="flex min-w-0 flex-1 items-center gap-1 hover:underline"
          {...(draggable ? listeners : {})}
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}

function UnscheduledTray({ tasks, base }: { tasks: CalendarTask[]; base: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: "sem-prazo" });
  return (
    <section
      ref={setNodeRef}
      aria-label="Sem prazo"
      className={cn("rounded-xl border border-dashed border-border bg-surface p-3", isOver && "bg-accent/10")}
    >
      <h3 className="text-xs font-semibold text-fg-muted">
        Sem prazo <span className="font-normal text-fg-subtle">{tasks.length}</span>
      </h3>
      <p className="mt-0.5 text-[11px] text-fg-subtle">
        Arraste para um dia para definir o prazo, ou solte aqui para remover o prazo.
      </p>
      {tasks.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {tasks.slice(0, 30).map((t) => (
            <li key={t.id} className="max-w-full rounded-md border border-border sm:max-w-64">
              <Chip task={t} base={base} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
