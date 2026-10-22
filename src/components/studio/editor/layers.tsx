"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Component,
  Copy,
  Eye,
  EyeOff,
  FileImage,
  Folder,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Minus,
  PenLine,
  Plus,
  Shapes,
  Square,
  Trash2,
  Triangle,
  Type,
  Unlock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { locate, type DesignObject, type DesignObjectType, type DesignPage } from "@/lib/design-doc";
import { cn } from "@/lib/utils";
import type { EditorActions } from "./actions";
import { useEditor, type EditorStore } from "./store";

const ICONS: Record<DesignObjectType, typeof Type> = {
  text: Type,
  image: ImageIcon,
  rect: Square,
  ellipse: Circle,
  triangle: Triangle,
  polygon: Shapes,
  line: Minus,
  path: PenLine,
  group: Folder,
  instance: Component,
  fabric: FileImage,
};

function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Páginas (com reordenação) e camadas da página ativa. */
export function PagesAndLayers({
  store,
  actions,
  canWrite,
}: {
  store: EditorStore;
  actions: EditorActions;
  canWrite: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PagesList store={store} actions={actions} canWrite={canWrite} />
      <LayersTree store={store} actions={actions} canWrite={canWrite} />
    </div>
  );
}

export function PagesList({
  store,
  actions,
  canWrite,
}: {
  store: EditorStore;
  actions: EditorActions;
  canWrite: boolean;
}) {
  const doc = useEditor(store, (s) => s.doc);
  const active = useEditor(store, (s) => s.activePageId);
  const sensors = useDndSensors();
  const [editing, setEditing] = useState<string | null>(null);
  const carousel = !!doc.meta?.carousel;
  const thumbs = usePageThumbs(store, doc.pages, carousel);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = doc.pages.findIndex((p) => p.id === e.over!.id);
    if (to >= 0)
      store.dispatch([{ op: "reorderPage", id: String(e.active.id), index: to }], { label: "Reordenar páginas" });
  };
  return (
    <section aria-label="Páginas">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-fg-subtle uppercase">
          {carousel ? "Slides do carrossel" : "Páginas"}
        </h3>
        {canWrite ? (
          <button
            type="button"
            onClick={() => actions.addPage()}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Adicionar página"
          >
            <Plus className="size-3.5" /> Página
          </button>
        ) : null}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={doc.pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-1" data-testid="pages-list">
            {doc.pages.map((p, i) => (
              <SortableRow key={p.id} id={p.id} disabled={!canWrite}>
                {(handle) => (
                  <div
                    data-page-id={p.id}
                    className={cn(
                      "group relative flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-sm",
                      p.id === active ? "border-accent bg-accent-soft/50" : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    {canWrite ? handle : null}
                    <span className="w-5 shrink-0 text-center text-[11px] text-fg-subtle tabular-nums">{i + 1}</span>
                    <PageThumb src={thumbs[p.id]} page={p} />
                    {editing === p.id ? (
                      <input
                        autoFocus
                        aria-label="Nome da página"
                        defaultValue={p.name}
                        onBlur={(e) => {
                          actions.renamePage(p.id, e.currentTarget.value);
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="h-6 min-w-0 flex-1 rounded border border-border bg-surface px-1 text-sm"
                      />
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => {
                          store.setSelection([]);
                          store.setActivePage(p.id);
                        }}
                        onDoubleClick={() => canWrite && setEditing(p.id)}
                        aria-current={p.id === active ? "page" : undefined}
                      >
                        <span className="block truncate">{p.name || `Página ${i + 1}`}</span>
                        <span className="block text-[11px] text-fg-subtle tabular-nums">
                          {p.width}×{p.height}
                        </span>
                      </button>
                    )}
                    {canWrite ? (
                      // Sobrepostos ao nome no hover/foco: o nome da página não fica espremido.
                      <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center rounded-md bg-surface/95 opacity-0 shadow-xs transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                        <RowButton
                          label={`Mover ${p.name} para cima`}
                          disabled={i === 0}
                          onClick={() => actions.movePage(p.id, -1)}
                        >
                          <ChevronDown className="rotate-180" />
                        </RowButton>
                        <RowButton
                          label={`Mover ${p.name} para baixo`}
                          disabled={i === doc.pages.length - 1}
                          onClick={() => actions.movePage(p.id, 1)}
                        >
                          <ChevronDown />
                        </RowButton>
                        <RowButton label={`Duplicar ${p.name}`} onClick={() => actions.duplicatePage(p.id)}>
                          <Copy />
                        </RowButton>
                        <RowButton
                          label={`Excluir ${p.name}`}
                          disabled={doc.pages.length === 1}
                          onClick={() => actions.removePage(p.id)}
                        >
                          <Trash2 />
                        </RowButton>
                      </span>
                    ) : null}
                  </div>
                )}
              </SortableRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}

/** Miniatura real da página (desenhada pela cena) ou um quadro com a proporção enquanto carrega. */
function PageThumb({ src, page }: { src?: string; page: DesignPage }) {
  const ratio = page.width / page.height;
  const w = ratio >= 1 ? 40 : Math.round(40 * ratio);
  const h = ratio >= 1 ? Math.round(40 / ratio) : 40;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL local, sem otimização de imagem
        <img src={src} alt="" width={w} height={h} className="rounded-[3px] border border-border object-cover" />
      ) : (
        <span className="rounded-[3px] border border-border bg-surface-2" style={{ width: w, height: h }} />
      )}
    </span>
  );
}

/**
 * Miniaturas das páginas, atualizadas ~0,7 s depois da última alteração e só
 * para as páginas que mudaram (no carrossel, também as vizinhas: um elemento pode
 * atravessar a divisa). Não desenha durante a edição de texto.
 */
function usePageThumbs(store: EditorStore, pages: DesignPage[], carousel: boolean) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const rendered = useRef(new Map<string, DesignPage>());
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const scene = store.scene;
      if (!scene || scene.isEditingText()) return;
      const changed = new Set<number>();
      pages.forEach((p, i) => {
        if (rendered.current.get(p.id) === p) return;
        changed.add(i);
        if (carousel) {
          changed.add(i - 1);
          changed.add(i + 1);
        }
      });
      if (!changed.size) return;
      const next: Record<string, string> = {};
      for (const i of changed) {
        const p = pages[i];
        if (!p) continue;
        try {
          const scale = Math.min(1, 96 / Math.max(p.width, p.height));
          next[p.id] = scene.renderPage(p.id, scale, { background: "#ffffff" }).toDataURL("image/jpeg", 0.7);
          rendered.current.set(p.id, p);
        } catch {
          // Página ainda não desenhada: tenta na próxima alteração.
        }
      }
      setThumbs((cur) => ({ ...cur, ...next }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [store, pages, carousel]);
  return thumbs;
}

function RowButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex size-6 items-center justify-center rounded text-fg-subtle hover:bg-surface hover:text-fg disabled:opacity-30 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle = (
    <button
      type="button"
      aria-label="Arrastar para reordenar"
      className="inline-flex size-5 shrink-0 cursor-grab items-center justify-center text-fg-subtle hover:text-fg [&_svg]:size-3.5"
      {...attributes}
      {...listeners}
    >
      <GripVertical />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("min-w-0", isDragging && "z-10 opacity-80")}
    >
      {children(handle)}
    </li>
  );
}

/** Árvore de camadas da página ativa (do topo para o fundo, como no canvas). */
export function LayersTree({
  store,
  actions,
  canWrite,
}: {
  store: EditorStore;
  actions: EditorActions;
  canWrite: boolean;
}) {
  const page = useEditor(store, (s) => s.activePage);
  const selection = useEditor(store, (s) => s.selection);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <section aria-label="Camadas da página">
      <h3 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Camadas · {page.name}</h3>
      {page.objects.length === 0 ? <p className="text-sm text-fg-muted">A página está vazia.</p> : null}
      <LayerList
        list={page.objects}
        parentId={null}
        depth={0}
        store={store}
        actions={actions}
        canWrite={canWrite}
        selection={selection}
        open={open}
        toggleOpen={toggleOpen}
      />
    </section>
  );
}

function LayerList({
  list,
  parentId,
  depth,
  store,
  actions,
  canWrite,
  selection,
  open,
  toggleOpen,
}: {
  list: DesignObject[];
  parentId: string | null;
  depth: number;
  store: EditorStore;
  actions: EditorActions;
  canWrite: boolean;
  selection: string[];
  open: Set<string>;
  toggleOpen: (id: string) => void;
}) {
  const sensors = useDndSensors();
  const reversed = [...list].reverse();
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = list.findIndex((o) => o.id === e.over!.id);
    if (to >= 0) store.dispatch([{ op: "reorder", id: String(e.active.id), to }], { label: "Ordem das camadas" });
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={reversed.map((o) => o.id)} strategy={verticalListSortingStrategy}>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5" data-testid={parentId ? undefined : "layers-list"}>
          {reversed.map((o) => (
            <SortableRow key={o.id} id={o.id} disabled={!canWrite}>
              {(handle) => (
                <LayerRow
                  o={o}
                  depth={depth}
                  handle={canWrite ? handle : null}
                  store={store}
                  actions={actions}
                  canWrite={canWrite}
                  selection={selection}
                  open={open}
                  toggleOpen={toggleOpen}
                />
              )}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function LayerRow({
  o,
  depth,
  handle,
  store,
  actions,
  canWrite,
  selection,
  open,
  toggleOpen,
}: {
  o: DesignObject;
  depth: number;
  handle: React.ReactNode;
  store: EditorStore;
  actions: EditorActions;
  canWrite: boolean;
  selection: string[];
  open: Set<string>;
  toggleOpen: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const Icon = ICONS[o.type];
  const isOpen = open.has(o.id);
  const selected = selection.includes(o.id);
  const select = (additive: boolean) => {
    const loc = locate(store.doc, o.id);
    // Filho de grupo: abre o grupo para selecionar o elemento dentro dele.
    if (loc?.parentId) store.enterGroup(loc.parentId);
    else if (store.enteredGroupId) store.enterGroup(null);
    store.setSelection(additive ? (selected ? selection.filter((s) => s !== o.id) : [...selection, o.id]) : [o.id]);
  };
  return (
    <div data-layer-id={o.id}>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md border py-1 pr-1 text-sm",
          selected ? "border-accent bg-accent-soft/50" : "border-transparent hover:bg-surface-2",
          o.hidden && "opacity-55",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {handle}
        {o.type === "group" ? (
          <button
            type="button"
            aria-label={isOpen ? "Recolher grupo" : "Expandir grupo"}
            onClick={() => toggleOpen(o.id)}
            className="inline-flex size-5 items-center justify-center text-fg-subtle hover:text-fg [&_svg]:size-3.5"
          >
            {isOpen ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : null}
        <Icon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        {renaming ? (
          <input
            autoFocus
            aria-label="Nome da camada"
            defaultValue={o.name}
            onBlur={(e) => {
              actions.rename(o.id, e.currentTarget.value);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="h-6 min-w-0 flex-1 rounded border border-border bg-surface px-1 text-sm"
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left"
            onClick={(e) => select(e.shiftKey || e.metaKey || e.ctrlKey)}
            onDoubleClick={() => canWrite && setRenaming(true)}
            aria-pressed={selected}
          >
            {o.name || (o.type === "text" ? o.text.slice(0, 24) : o.type)}
          </button>
        )}
        {canWrite ? (
          <span
            className={cn(
              "flex shrink-0 items-center",
              !o.hidden && !o.locked && "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            )}
          >
            <RowButton label={o.hidden ? "Mostrar" : "Ocultar"} onClick={() => actions.toggleHidden(o.id)}>
              {o.hidden ? <EyeOff /> : <Eye />}
            </RowButton>
            <RowButton label={o.locked ? "Desbloquear" : "Bloquear"} onClick={() => actions.toggleLocked(o.id)}>
              {o.locked ? <Lock /> : <Unlock />}
            </RowButton>
          </span>
        ) : null}
      </div>
      {o.type === "group" && isOpen ? (
        <LayerList
          list={o.children}
          parentId={o.id}
          depth={depth + 1}
          store={store}
          actions={actions}
          canWrite={canWrite}
          selection={selection}
          open={open}
          toggleOpen={toggleOpen}
        />
      ) : null}
    </div>
  );
}
