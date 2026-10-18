"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type KanbanColumn = { id: string; title: string; color: string; footer?: React.ReactNode };
export type KanbanItem = { id: string; columnId: string };

export type MoveArgs<T> = {
  item: T;
  fromColumnId: string;
  toColumnId: string;
  /** Vizinhos na posição final (para ordenação fracionária). */
  beforeId: string | null;
  afterId: string | null;
};

type Props<T extends KanbanItem> = {
  columns: KanbanColumn[];
  items: T[];
  renderCard: (item: T, opts: { dragging: boolean }) => React.ReactNode;
  /** Persiste o movimento. Retorne false para desfazer (ex.: transição não permitida). */
  onMove: (args: MoveArgs<T>) => Promise<boolean>;
  columnAction?: (column: KanbanColumn) => React.ReactNode;
  emptyLabel?: string;
};

function group<T extends KanbanItem>(columns: KanbanColumn[], items: T[]) {
  const map: Record<string, T[]> = Object.fromEntries(columns.map((c) => [c.id, []]));
  for (const it of items) (map[it.columnId] ??= []).push(it);
  return map;
}

/**
 * Quadro Kanban com arrastar e soltar (mouse, toque e teclado).
 * A mudança aparece na hora (otimista) e é desfeita se o servidor recusar.
 */
export function KanbanBoard<T extends KanbanItem>({
  columns,
  items,
  renderCard,
  onMove,
  columnAction,
  emptyLabel = "Nada aqui",
}: Props<T>) {
  const [board, setBoard] = useState(() => group(columns, items));
  const [activeId, setActiveId] = useState<string | null>(null);
  const snapshot = useRef<Record<string, T[]> | null>(null);
  const dndId = useId();
  const origin = useRef<string | null>(null);

  // Sincroniza com dados novos do servidor (após refresh), exceto durante um arrasto.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflete dados vindos do servidor
    if (!activeId) setBoard(group(columns, items));
  }, [columns, items, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIndex = useMemo(() => {
    const idx = new Map<string, string>();
    for (const [col, list] of Object.entries(board)) for (const it of list) idx.set(it.id, col);
    return idx;
  }, [board]);

  const findColumn = (id: string) => (board[id] ? id : itemIndex.get(id));
  const activeItem = activeId
    ? Object.values(board)
        .flat()
        .find((i) => i.id === activeId)
    : null;

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    snapshot.current = board;
    origin.current = itemIndex.get(id) ?? null;
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = findColumn(String(active.id));
    const to = findColumn(String(over.id));
    if (!from || !to || from === to) return;
    setBoard((prev) => {
      const source = [...(prev[from] ?? [])];
      const target = [...(prev[to] ?? [])];
      const i = source.findIndex((x) => x.id === active.id);
      if (i < 0) return prev;
      const [moved] = source.splice(i, 1);
      const overIndex = target.findIndex((x) => x.id === over.id);
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, { ...moved!, columnId: to });
      return { ...prev, [from]: source, [to]: target };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const id = String(active.id);
    const fromColumnId = origin.current;
    setActiveId(null);
    if (!over || !fromColumnId) {
      if (snapshot.current) setBoard(snapshot.current);
      return;
    }
    const col = findColumn(id);
    if (!col) return;
    let list = [...(board[col] ?? [])];
    const oldIndex = list.findIndex((x) => x.id === id);
    const overIndex = list.findIndex((x) => x.id === over.id);
    if (overIndex >= 0 && oldIndex !== overIndex) {
      const [moved] = list.splice(oldIndex, 1);
      list.splice(overIndex, 0, moved!);
    }
    list = list.map((x) => (x.id === id ? { ...x, columnId: col } : x));
    const next = { ...board, [col]: list };
    setBoard(next);

    const finalIndex = list.findIndex((x) => x.id === id);
    const unchanged = col === fromColumnId && snapshot.current?.[col]?.findIndex((x) => x.id === id) === finalIndex;
    if (unchanged) return;

    const item = list[finalIndex]!;
    const ok = await onMove({
      item,
      fromColumnId,
      toColumnId: col,
      beforeId: list[finalIndex - 1]?.id ?? null,
      afterId: list[finalIndex + 1]?.id ?? null,
    });
    if (!ok && snapshot.current) setBoard(snapshot.current);
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        if (snapshot.current) setBoard(snapshot.current);
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Pressione espaço para pegar o cartão, use as setas para mover e espaço novamente para soltar. Esc cancela.",
        },
      }}
    >
      <div className="-mx-4 flex snap-x scroll-px-4 scrollbar-thin gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:snap-none lg:px-8">
        {columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            items={board[col.id] ?? []}
            renderCard={renderCard}
            action={columnAction?.(col)}
            emptyLabel={emptyLabel}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
        {activeItem ? (
          <div className="rotate-[1.5deg] cursor-grabbing">{renderCard(activeItem, { dragging: true })}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column<T extends KanbanItem>({
  column,
  items,
  renderCard,
  action,
  emptyLabel,
}: {
  column: KanbanColumn;
  items: T[];
  renderCard: Props<T>["renderCard"];
  action?: React.ReactNode;
  emptyLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      className="flex w-[280px] shrink-0 snap-start flex-col rounded-xl border border-border bg-surface-2/60 sm:w-[296px]"
      aria-label={column.title}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <StatusDot color={column.color} />
        <h3 className="flex-1 truncate text-[13px] font-semibold text-fg">{column.title}</h3>
        <span className="tabular text-xs text-fg-subtle">{items.length}</span>
        {action}
      </header>
      <SortableContext id={column.id} items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 scrollbar-thin flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors",
            isOver && "bg-accent-soft/40",
          )}
          style={{ maxHeight: "calc(100dvh - 260px)" }}
        >
          {items.map((item) => (
            <SortableCard key={item.id} id={item.id}>
              {renderCard(item, { dragging: false })}
            </SortableCard>
          ))}
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-fg-subtle">
              {emptyLabel}
            </p>
          ) : null}
        </div>
      </SortableContext>
      {column.footer ? <div className="px-2 pb-2">{column.footer}</div> : null}
    </section>
  );
}

function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation outline-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
