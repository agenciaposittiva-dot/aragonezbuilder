"use client";

import {
  Circle,
  Component,
  Hand,
  ImagePlus,
  Maximize,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Square,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { locate } from "@/lib/design-doc";
import { cn } from "@/lib/utils";
import type { EditorActions } from "./actions";
import type { Scene } from "./scene";
import { useEditor, type EditorStore, type Tool } from "./store";

/*
 * Área central: o canvas ocupa todo o espaço livre (as barras laterais têm
 * largura fixa e viram gavetas no celular), com réguas, nomes das páginas,
 * barra de ferramentas flutuante e menu de contexto.
 */

const RULER = 20;

function useWide() {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

function useViewport(scene: Scene | null) {
  return useSyncExternalStore(
    (fn) => (scene ? scene.onViewport(fn) : () => undefined),
    () => (scene ? JSON.stringify(scene.viewport()) : ""),
    () => "",
  );
}

export function CanvasArea({
  store,
  scene,
  actions,
  canWrite,
  canvasRef,
  onReady,
  onPickImage,
  onComponents,
  ready,
}: {
  store: EditorStore;
  scene: Scene | null;
  actions: EditorActions;
  canWrite: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onReady: (size: { width: number; height: number }) => void;
  onPickImage: () => void;
  onComponents: () => void;
  ready: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const view = useEditor(store, (s) => s.view);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Réguas só em telas largas: no celular o espaço é todo do canvas.
  const wide = useWide();
  const rulers = view.rulers && canWrite && wide;

  // Tamanho do canvas acompanha o espaço disponível.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - (rulers ? RULER : 0);
      const h = el.clientHeight - (rulers ? RULER : 0);
      if (first) {
        first = false;
        onReady({ width: w, height: h });
      }
      scene?.setSize(w, h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene, onReady, rulers]);

  // Gestos de dois dedos: pinça para zoom e arraste para mover a vista.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !scene) return;
    let last: { d: number; x: number; y: number } | null = null;
    const info = (t: TouchList) => {
      const a = t[0]!;
      const b = t[1]!;
      return {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      scene.cancelPointer();
      last = info(e.touches);
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !last) return;
      e.preventDefault();
      const now = info(e.touches);
      const rect = scene.canvas.upperCanvasEl.getBoundingClientRect();
      scene.panBy(now.x - last.x, now.y - last.y);
      if (last.d > 0) scene.zoomTo(scene.zoom * (now.d / last.d), { x: now.x - rect.left, y: now.y - rect.top });
      last = now;
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) last = null;
    };
    el.addEventListener("touchstart", start, { passive: false, capture: true });
    el.addEventListener("touchmove", move, { passive: false, capture: true });
    el.addEventListener("touchend", end, { capture: true });
    return () => {
      el.removeEventListener("touchstart", start, { capture: true });
      el.removeEventListener("touchmove", move, { capture: true });
      el.removeEventListener("touchend", end, { capture: true });
    };
  }, [scene]);

  return (
    <div
      ref={boxRef}
      className="relative min-w-0 flex-1 touch-none overflow-hidden select-none"
      style={{ background: "var(--surface-3)" }}
      data-testid="editor-canvas"
      onContextMenu={(e) => {
        e.preventDefault();
        if (!scene || !canWrite) return;
        const id = scene.hitTest(e.nativeEvent);
        if (id && !store.selection.includes(id)) store.setSelection([id]);
        const rect = boxRef.current!.getBoundingClientRect();
        // O menu (≈ 220 × 420 px) não passa da borda da área.
        setMenu({
          x: Math.min(e.clientX - rect.left, rect.width - 224),
          y: Math.min(e.clientY - rect.top, Math.max(4, rect.height - 430)),
        });
      }}
      onDragOver={(e) => {
        if (canWrite && e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!canWrite) return;
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault();
        files.slice(0, 10).forEach((f) => void actions.addImageFromFile(f));
      }}
    >
      {rulers ? <Rulers scene={scene} store={store} /> : null}
      <div className="absolute" style={{ left: rulers ? RULER : 0, top: rulers ? RULER : 0, right: 0, bottom: 0 }}>
        <canvas ref={canvasRef} />
        <PageLabels scene={scene} store={store} actions={actions} canWrite={canWrite} />
      </div>
      {!ready ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">Carregando editor…</p>
      ) : null}
      {canWrite ? <Toolbar store={store} onPickImage={onPickImage} onComponents={onComponents} /> : null}
      <Button
        variant="secondary"
        size="icon-sm"
        className="absolute right-3 bottom-3 shadow-md lg:hidden"
        onClick={() => scene?.fit("page")}
        aria-label="Ajustar à tela"
      >
        <Maximize />
      </Button>
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} store={store} actions={actions} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ferramentas                                                         */
/* ------------------------------------------------------------------ */

const TOOLS: { tool: Tool; icon: typeof Type; label: string; key: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Selecionar", key: "V" },
  { tool: "hand", icon: Hand, label: "Mão (mover a vista)", key: "H" },
  { tool: "text", icon: Type, label: "Texto", key: "T" },
  { tool: "rect", icon: Square, label: "Retângulo", key: "R" },
  { tool: "ellipse", icon: Circle, label: "Elipse", key: "O" },
  { tool: "line", icon: Minus, label: "Linha", key: "L" },
  { tool: "draw", icon: PenLine, label: "Desenho livre", key: "P" },
];

function Toolbar({
  store,
  onPickImage,
  onComponents,
}: {
  store: EditorStore;
  onPickImage: () => void;
  onComponents: () => void;
}) {
  const tool = useEditor(store, (s) => s.tool);
  return (
    <div
      role="toolbar"
      aria-label="Ferramentas de desenho"
      className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-lg lg:flex"
    >
      {TOOLS.map(({ tool: t, icon: Icon, label, key }) => (
        <Tooltip key={t} content={`${label} (${key})`}>
          <button
            type="button"
            aria-label={label}
            aria-pressed={tool === t}
            onClick={() => store.setTool(t)}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-lg [&_svg]:size-[18px]",
              tool === t ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon />
          </button>
        </Tooltip>
      ))}
      <span className="mx-1 h-6 w-px bg-border" />
      <Tooltip content="Imagem">
        <button
          type="button"
          aria-label="Inserir imagem"
          onClick={onPickImage}
          className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-[18px]"
        >
          <ImagePlus />
        </button>
      </Tooltip>
      <Tooltip content="Componentes">
        <button
          type="button"
          aria-label="Componentes"
          onClick={onComponents}
          className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-[18px]"
        >
          <Component />
        </button>
      </Tooltip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Réguas                                                              */
/* ------------------------------------------------------------------ */

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

function Rulers({ scene, store }: { scene: Scene | null; store: EditorStore }) {
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);
  const vp = useViewport(scene);
  const active = useEditor(store, (s) => s.activePageId);
  const doc = useEditor(store, (s) => s.doc);
  const selection = useEditor(store, (s) => s.selection);

  useEffect(() => {
    if (!scene) return;
    const v = scene.viewport();
    const page = scene.pageRect(active) ?? scene.pages[0];
    if (!page) return;
    const dpr = window.devicePixelRatio || 1;
    const sel = selection.length ? scene.selectionScreenBox() : null;
    const draw = (c: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!c) return;
      const len = horizontal ? v.width : v.height;
      const w = horizontal ? len : RULER;
      const h = horizontal ? RULER : len;
      c.width = Math.ceil(w * dpr);
      c.height = Math.ceil(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Desenha sempre na horizontal; a régua vertical é a mesma girada.
      if (!horizontal) {
        ctx.translate(RULER, 0);
        ctx.rotate(Math.PI / 2);
      }
      const styles = getComputedStyle(c);
      ctx.fillStyle = styles.getPropertyValue("--surface").trim() || "#fff";
      ctx.fillRect(0, 0, len, RULER);
      const origin = horizontal ? page.x * v.zoom + v.x : page.y * v.zoom + v.y;
      const size = (horizontal ? page.width : page.height) * v.zoom;
      ctx.fillStyle = "rgba(244,191,47,0.16)";
      ctx.fillRect(origin, 0, size, RULER);
      if (sel) {
        ctx.fillStyle = "rgba(217,162,26,0.35)";
        ctx.fillRect(horizontal ? sel.x : sel.y, 0, horizontal ? sel.width : sel.height, RULER);
      }
      const step = STEPS.find((s) => s * v.zoom >= 60) ?? 10_000;
      const minor = step / 5;
      ctx.strokeStyle = styles.getPropertyValue("--border-strong").trim() || "#ccc";
      ctx.fillStyle = styles.getPropertyValue("--fg-subtle").trim() || "#888";
      ctx.font = "10px sans-serif";
      ctx.lineWidth = 1;
      const startUnit = Math.floor(-origin / v.zoom / minor) * minor;
      const endUnit = (len - origin) / v.zoom;
      ctx.beginPath();
      for (let u = startUnit; u <= endUnit; u += minor) {
        const p = Math.round(origin + u * v.zoom) + 0.5;
        const major = Math.abs(u / step - Math.round(u / step)) < 1e-6;
        ctx.moveTo(p, RULER);
        ctx.lineTo(p, major ? RULER * 0.35 : RULER * 0.7);
        if (major) ctx.fillText(String(Math.round(u)), p + 3, 10);
      }
      ctx.stroke();
      ctx.strokeStyle = styles.getPropertyValue("--border").trim() || "#ddd";
      ctx.beginPath();
      ctx.moveTo(0, RULER - 0.5);
      ctx.lineTo(len, RULER - 0.5);
      ctx.stroke();
    };
    draw(top.current, true);
    draw(left.current, false);
  }, [scene, vp, active, doc, selection]);

  const startGuide = (axis: "v" | "h") => (e: React.PointerEvent) => {
    if (!scene) return;
    e.preventDefault();
    scene.beginGuideFromRuler(axis);
    const move = (ev: PointerEvent) => scene.moveGuideFromRuler(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      scene.finishGuideDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <div className="absolute top-0 left-0 z-[1] size-5 border-r border-b border-border bg-surface" />
      <canvas
        ref={top}
        className="absolute top-0 z-[1] cursor-row-resize"
        style={{ left: RULER }}
        title="Arraste para criar uma guia horizontal"
        aria-label="Régua horizontal"
        onPointerDown={startGuide("h")}
      />
      <canvas
        ref={left}
        className="absolute left-0 z-[1] cursor-col-resize"
        style={{ top: RULER }}
        title="Arraste para criar uma guia vertical"
        aria-label="Régua vertical"
        onPointerDown={startGuide("v")}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Nomes das páginas sobre o canvas                                    */
/* ------------------------------------------------------------------ */

function PageLabels({
  scene,
  store,
  actions,
  canWrite,
}: {
  scene: Scene | null;
  store: EditorStore;
  actions: EditorActions;
  canWrite: boolean;
}) {
  useViewport(scene);
  const doc = useEditor(store, (s) => s.doc);
  const active = useEditor(store, (s) => s.activePageId);
  if (!scene || !scene.pages.length) return null;
  const v = scene.viewport();
  const carousel = !!doc.meta?.carousel;
  const last = scene.pages[scene.pages.length - 1]!;
  // Prancheta tracejada depois do último slide: adiciona um slide no fim (como a referência de carrosséis).
  const addLeft = (last.x + last.width) * v.zoom + v.x + 24;
  const addTop = last.y * v.zoom + v.y;
  const addWidth = Math.min(180, Math.max(64, last.width * v.zoom * 0.45));
  const addHeight = Math.max(80, last.height * v.zoom);
  const showAdd = carousel && canWrite && addLeft < v.width && addTop + addHeight > 0 && addTop < v.height;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {doc.pages.length >= 2
        ? scene.pages.map((r) => {
            const page = doc.pages[r.index];
            if (!page) return null;
            const left = r.x * v.zoom + v.x;
            const top = r.y * v.zoom + v.y - 22;
            const width = r.width * v.zoom;
            if (left + width < 0 || left > v.width) return null;
            const isActive = r.id === active;
            return (
              <div
                key={r.id}
                className="pointer-events-auto absolute flex items-center gap-1"
                style={{ left, top: Math.max(2, top), maxWidth: Math.max(40, width) }}
              >
                <button
                  type="button"
                  onClick={() => {
                    store.setSelection([]);
                    store.setActivePage(r.id);
                  }}
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 truncate rounded px-1 text-left text-[11px] font-medium",
                    isActive ? "text-accent-text" : "text-fg-muted hover:text-fg",
                  )}
                  title={page.name}
                  data-testid="page-label"
                  data-active={isActive ? "true" : "false"}
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full", isActive ? "bg-accent" : "bg-border-strong")}
                  />
                  {carousel ? `Slide ${r.index + 1}` : page.name}
                </button>
                {carousel && canWrite && isActive && width > 120 ? (
                  <button
                    type="button"
                    onClick={() => actions.duplicatePage(r.id)}
                    className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[10px] font-medium text-fg-muted hover:bg-surface hover:text-fg"
                    aria-label={`Duplicar slide ${r.index + 1}`}
                  >
                    Duplicar
                  </button>
                ) : null}
              </div>
            );
          })
        : null}
      {showAdd ? (
        <button
          type="button"
          onClick={() => actions.addPage(last.id)}
          aria-label="Adicionar slide"
          data-testid="add-slide"
          className="pointer-events-auto absolute flex items-center justify-center rounded-md border-2 border-dashed border-border-strong/70 text-fg-subtle transition-colors hover:border-accent hover:text-fg focus-visible:border-accent focus-visible:outline-none"
          style={{ left: addLeft, top: addTop, width: addWidth, height: addHeight }}
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Menu de contexto                                                    */
/* ------------------------------------------------------------------ */

function ContextMenu({
  x,
  y,
  store,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  store: EditorStore;
  actions: EditorActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const sel = store.selection;
  const objs = sel.map((id) => locate(store.doc, id)?.object).filter(Boolean);
  const has = objs.length > 0;
  const group = objs.length === 1 && objs[0]!.type === "group";
  const instance = objs.some((o) => o!.type === "instance");
  const items: ([string, () => void, string?] | null)[] = has
    ? [
        ["Copiar", () => void actions.copy(), "Ctrl+C"],
        ["Recortar", () => void actions.copy(true), "Ctrl+X"],
        ["Colar", () => void actions.paste(), "Ctrl+V"],
        ["Duplicar", actions.duplicate, "Ctrl+D"],
        ["Excluir", actions.remove, "Del"],
        null,
        ["Trazer para frente", () => actions.reorder("forward"), "Ctrl+]"],
        ["Enviar para trás", () => actions.reorder("backward"), "Ctrl+["],
        ["Trazer para o topo", () => actions.reorder("front")],
        ["Enviar para o fundo", () => actions.reorder("back")],
        null,
        objs.length > 1 ? ["Agrupar", actions.group, "Ctrl+G"] : null,
        group ? ["Desagrupar", actions.ungroup, "Ctrl+Shift+G"] : null,
        ["Criar componente", actions.createComponent, "Ctrl+Alt+K"],
        instance ? ["Desvincular componente", actions.detach] : null,
        objs.length === 1
          ? [objs[0]!.locked ? "Desbloquear" : "Bloquear", () => actions.toggleLocked(sel[0]!), "Ctrl+Shift+L"]
          : null,
        objs.length === 1
          ? [objs[0]!.hidden ? "Mostrar" : "Ocultar", () => actions.toggleHidden(sel[0]!), "Ctrl+Shift+H"]
          : null,
      ]
    : [
        ["Colar", () => void actions.paste(), "Ctrl+V"],
        ["Selecionar tudo", actions.selectAll, "Ctrl+A"],
      ];
  const list = items.filter((i, idx, arr) => i !== null || (idx > 0 && arr[idx - 1] !== null));
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Ações do elemento"
      className="absolute z-[var(--z-popover)] min-w-52 rounded-lg border border-border bg-surface p-1 text-sm shadow-lg"
      style={{ left: Math.max(4, x), top: Math.max(4, y) }}
    >
      {list.map((it, i) =>
        it ? (
          <button
            key={it[0]}
            type="button"
            role="menuitem"
            onClick={() => {
              it[1]();
              onClose();
            }}
            className="flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
          >
            {it[0]}
            {it[2] ? <span className="text-[11px] text-fg-subtle">{it[2]}</span> : null}
          </button>
        ) : (
          <div key={`sep${i}`} className="my-1 h-px bg-border" />
        ),
      )}
    </div>
  );
}
