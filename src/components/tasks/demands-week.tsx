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
import { GripVertical } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { PriorityIcon } from "@/components/app/priority";
import { StatusDot } from "@/components/ui/badge";
import { useOrgAction } from "@/hooks/use-action";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateTaskAction } from "@/server/actions/tasks";
import type { TaskListRow } from "@/server/services/tasks";
import { TaskDoneCheckbox } from "./task-done-checkbox";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayTitle(iso: string, today: string) {
  if (iso === today) return "Hoje";
  if (iso === plusDays(today, 1)) return "Amanhã";
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Status = { id: string; name: string; color: string };

/**
 * Minha semana: atrasadas + hoje + 6 dias. Arrastar um cartão para outro dia
 * muda o prazo da própria tarefa (o calendário e a lista mostram o mesmo dado).
 * "Por etapa" agrupa cada dia pelo fluxo; "Por prazo" ordena por urgência.
 */
export function DemandsWeek({
  rows,
  statuses,
  order,
  base,
  canWrite,
  listHref,
}: {
  rows: TaskListRow[];
  statuses: Status[];
  order: "etapa" | "prazo";
  base: string;
  canWrite: boolean;
  /** Mesma busca/pessoa, na visualização em lista. */
  listHref: string;
}) {
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => plusDays(today, i));
  const last = days[days.length - 1]!;
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [dragging, setDragging] = useState<TaskListRow | null>(null);
  const update = useOrgAction(updateTaskAction);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const view = useMemo(
    () => rows.map((r) => (r.id in overrides ? { ...r, dueDate: overrides[r.id]! } : r)),
    [rows, overrides],
  );
  const statusIndex = useMemo(() => new Map(statuses.map((s, i) => [s.id, i])), [statuses]);
  const sort = (list: TaskListRow[]) =>
    [...list].sort((a, b) =>
      order === "etapa"
        ? (statusIndex.get(a.statusId) ?? 99) - (statusIndex.get(b.statusId) ?? 99) ||
          PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
        : PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
          (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
          a.title.localeCompare(b.title, "pt-BR"),
    );

  const overdue = sort(view.filter((r) => r.dueDate && r.dueDate < today));
  const byDay = new Map(days.map((d) => [d, sort(view.filter((r) => r.dueDate === d))]));
  const later = view.filter((r) => r.dueDate && r.dueDate > last).length;
  const noDue = view.filter((r) => !r.dueDate).length;

  async function moveTo(task: TaskListRow, date: string) {
    if (task.dueDate === date) return;
    // Prazo antes do início é recusado pelo servidor; a mensagem vem dele e o cartão volta.
    const before = task.id in overrides ? overrides[task.id]! : task.dueDate;
    setOverrides((o) => ({ ...o, [task.id]: date }));
    const res = await update.run({ id: task.id, dueDate: date });
    if (!res.ok) setOverrides((o) => ({ ...o, [task.id]: before }));
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(view.find((t) => t.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const task = view.find((t) => t.id === e.active.id);
    const target = e.over?.id;
    if (task && typeof target === "string") void moveTo(task, target);
  }

  const column = (key: string, title: string, list: TaskListRow[], opts: { droppable: boolean; tone?: "danger" }) => (
    <DayColumn key={key} id={key} droppable={opts.droppable && canWrite} title={title} count={list.length} tone={opts.tone}>
      {list.length === 0 ? (
        <p className="px-1 py-3 text-center text-[11px] text-fg-subtle">{opts.droppable ? "Livre" : "—"}</p>
      ) : order === "etapa" ? (
        groupByStatus(list, statuses).map((g) => (
          <div key={g.id} className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            <p className="flex items-center gap-1.5 px-0.5 text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">
              <StatusDot color={g.color} /> {g.name}
            </p>
            {g.rows.map((t) => (
              <Card key={t.id} task={t} base={base} canWrite={canWrite} />
            ))}
          </div>
        ))
      ) : (
        list.map((t) => <Card key={t.id} task={t} base={base} canWrite={canWrite} />)
      )}
    </DayColumn>
  );

  return (
    <DndContext id={dndId} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div
        className="grid grid-cols-1 gap-3 md:grid-flow-col md:grid-cols-none md:auto-cols-[minmax(210px,1fr)] md:overflow-x-auto md:pb-2"
        data-testid="demands-week"
      >
        {overdue.length ? column("overdue", "Atrasadas", overdue, { droppable: false, tone: "danger" }) : null}
        {days.map((d) => column(d, dayTitle(d, today), byDay.get(d) ?? [], { droppable: true }))}
      </div>
      {later || noDue ? (
        <p className="mt-3 text-xs text-fg-muted">
          Fora desta semana: {later ? `${later} com prazo mais adiante` : null}
          {later && noDue ? " · " : null}
          {noDue ? `${noDue} sem prazo` : null}.{" "}
          <Link href={listHref} className="font-medium text-fg underline-offset-2 hover:underline">
            Ver na lista
          </Link>
        </p>
      ) : null}
      <DragOverlay>{dragging ? <Card task={dragging} base={base} canWrite={false} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function groupByStatus(list: TaskListRow[], statuses: Status[]) {
  const groups: { id: string; name: string; color: string; rows: TaskListRow[] }[] = [];
  for (const t of list) {
    let g = groups.find((x) => x.id === t.statusId);
    if (!g) {
      const st = statuses.find((s) => s.id === t.statusId);
      g = { id: t.statusId, name: st?.name ?? t.statusName, color: st?.color ?? t.statusColor, rows: [] };
      groups.push(g);
    }
    g.rows.push(t);
  }
  return groups;
}

function DayColumn({
  id,
  droppable,
  title,
  count,
  tone,
  children,
}: {
  id: string;
  droppable: boolean;
  title: string;
  count: number;
  tone?: "danger";
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable });
  return (
    <section
      ref={setNodeRef}
      aria-label={title}
      data-day={id}
      className={cn(
        "flex min-h-28 min-w-0 flex-col rounded-xl border bg-surface-2/60 p-2 transition-colors",
        tone === "danger" ? "border-danger/30 bg-danger-soft/40" : "border-border",
        isOver && "border-accent bg-accent-soft/40",
      )}
    >
      <h3
        className={cn(
          "mb-2 flex items-center justify-between px-1 text-xs font-semibold",
          tone === "danger" ? "text-danger" : "text-fg",
        )}
      >
        {title}
        <span className="font-normal text-fg-subtle tabular-nums">{count}</span>
      </h3>
      {/* minmax(0,1fr): o cartão não passa da largura da coluna (texto truncado empurrava a largura). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">{children}</div>
    </section>
  );
}

function Card({
  task,
  base,
  canWrite,
  overlay,
}: {
  task: TaskListRow;
  base: string;
  canWrite: boolean;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite || overlay,
  });
  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      className={cn(
        "group flex items-start gap-2 rounded-lg border border-border bg-surface p-2 shadow-xs",
        isDragging && "opacity-40",
        overlay && "shadow-lg",
      )}
    >
      <TaskDoneCheckbox taskId={task.id} done={!!task.completedAt} disabled={!canWrite} label={task.title} />
      <div className="min-w-0 flex-1">
        <Link
          href={`${base}/tasks/${task.id}`}
          className="line-clamp-2 text-[13px] leading-snug font-medium text-fg hover:underline"
        >
          {task.title}
        </Link>
        <p className="mt-0.5 truncate text-[11px] text-fg-muted">
          {task.clientName} · {task.projectName}
        </p>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <StatusDot color={task.statusColor} />
          <span className="truncate">{task.statusName}</span>
          <span className="flex-1" />
          <PriorityIcon priority={task.priority} />
        </div>
      </div>
      {canWrite && !overlay ? (
        <button
          type="button"
          aria-label={`Arrastar “${task.title}” para outro dia`}
          className="-mr-1 inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-subtle opacity-60 group-hover:opacity-100 hover:text-fg"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : null}
    </article>
  );
}
