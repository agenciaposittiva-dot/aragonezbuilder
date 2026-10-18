"use client";

import type * as FabricNS from "fabric";
import {
  allObjects,
  ellipseObject,
  lineObject,
  locate,
  newId,
  normalizeRotation,
  pathObject,
  rectObject,
  textObject,
  withGroupBox,
  type DesignDocument,
  type DesignObject,
  type DesignOp,
  type DesignPage,
} from "@/lib/design-doc";
import { loadImage } from "./media";
import {
  createFabricObject,
  enlivenLegacy,
  setupFabricDefaults,
  toFabricPaint,
  type Fabric,
  type FObj,
} from "./render";
import { computeSnap, snapTargets, type SnapLine, type SnapTarget } from "./snap";
import type { EditorStore, Tool } from "./store";

/*
 * Cena do editor: desenha o documento do store num único canvas do Fabric com
 * todas as páginas lado a lado (área de trabalho ao redor) e devolve ao store,
 * como operações, o que a pessoa faz com o mouse e o toque (mover, girar,
 * redimensionar, editar texto, desenhar). Só o que mudou é redesenhado: os
 * objetos do documento são imutáveis e comparados por referência.
 */

export type PageRect = { id: string; index: number; x: number; y: number; width: number; height: number };
type Entry = { sig: unknown[]; obj: FObj };
type FCanvas = FabricNS.Canvas & {
  _objects: FObj[];
  _renderOverlay: (ctx: CanvasRenderingContext2D) => void;
  contextTop: CanvasRenderingContext2D;
};

const round = (n: number) => Math.round(n * 100) / 100;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;

export type SceneOptions = {
  canWrite: boolean;
  /** Avisa quando um texto entra/sai de edição (atalhos ficam desligados durante a digitação). */
  onTextEditing?: (editing: boolean) => void;
};

export class Scene {
  readonly canvas: FCanvas;
  readonly fabric: Fabric;
  pages: PageRect[] = [];
  private store: EditorStore;
  private opts: SceneOptions;
  private entries = new Map<string, Entry>();
  private artboards = new Map<string, Entry>();
  private lastDoc: DesignDocument | null = null;
  private lastEntered: string | null = null;
  private syncing = false;
  private exporting = false;
  private snapLines: SnapLine[] = [];
  private snapCache: { targets: { x: SnapTarget[]; y: SnapTarget[] }; page: PageRect } | null = null;
  private hovered: FObj | null = null;
  private viewportListeners = new Set<() => void>();
  private unsubscribe: () => void;
  private editing: FObj | null = null;
  private editingHeight = 0;
  private waiting = new Map<string, Set<string>>();
  private drawingShape: { tool: Tool; start: FabricNS.Point; temp: FObj | null; page: PageRect } | null = null;
  private panning: { x: number; y: number } | null = null;
  private guideDrag: {
    pageId: string;
    axis: "v" | "h";
    index: number | null;
    value: number;
    fromRuler: boolean;
  } | null = null;
  spaceHeld = false;
  workspaceColor = "#e8e6e1";
  private disposed = false;

  constructor(el: HTMLCanvasElement, fabric: Fabric, store: EditorStore, opts: SceneOptions) {
    this.fabric = fabric;
    this.store = store;
    this.opts = opts;
    setupFabricDefaults(fabric);
    this.canvas = new fabric.Canvas(el, {
      preserveObjectStacking: true,
      selection: opts.canWrite,
      selectionColor: "rgba(244,191,47,0.10)",
      selectionBorderColor: "#d9a21a",
      selectionLineWidth: 1,
      controlsAboveOverlay: true,
      fireRightClick: true,
      stopContextMenu: true,
      enableRetinaScaling: true,
      targetFindTolerance: 4,
      uniformScaling: true,
    }) as FCanvas;
    // A máscara da área de trabalho entra como "overlay": por cima dos objetos e por baixo dos controles.
    const renderOverlay = this.canvas._renderOverlay.bind(this.canvas);
    this.canvas._renderOverlay = (ctx) => {
      renderOverlay(ctx);
      if (!this.exporting) this.drawOverlay(ctx);
    };
    this.bindEvents();
    this.unsubscribe = store.subscribe(() => this.onStore());
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe();
    void this.canvas.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* Layout das páginas                                                */
  /* ---------------------------------------------------------------- */

  private layout(doc: DesignDocument) {
    const carousel = !!doc.meta?.carousel;
    const maxH = Math.max(...doc.pages.map((p) => p.height));
    const gap = carousel ? 0 : Math.round(Math.max(80, maxH * 0.08));
    let x = 0;
    this.pages = doc.pages.map((p, index) => {
      const r = { id: p.id, index, x, y: 0, width: p.width, height: p.height };
      x += p.width + gap;
      return r;
    });
  }

  pageRect(id: string) {
    return this.pages.find((p) => p.id === id) ?? null;
  }

  pageAt(p: { x: number; y: number }) {
    return this.pages.find((r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Sincronização documento → Fabric                                 */
  /* ---------------------------------------------------------------- */

  private onStore() {
    if (this.disposed) return;
    const s = this.store;
    if (s.doc !== this.lastDoc || s.enteredGroupId !== this.lastEntered) this.sync();
    else this.applySelection();
    this.canvas.selection = this.opts.canWrite && s.tool === "select" && !this.spaceHeld;
    this.canvas.isDrawingMode = this.opts.canWrite && s.tool === "draw";
    if (this.canvas.isDrawingMode) this.configureBrush();
    this.canvas.defaultCursor =
      s.tool === "hand" || this.spaceHeld ? "grab" : s.tool === "select" ? "default" : "crosshair";
    this.canvas.requestRenderAll();
  }

  /** Redesenha só o que mudou desde a última vez. */
  sync() {
    // Remover/trocar objetos dispara eventos de seleção do Fabric que não vêm da pessoa.
    this.syncing = true;
    try {
      this.syncNow();
    } finally {
      this.syncing = false;
    }
  }

  private syncNow() {
    const s = this.store;
    const doc = s.doc;
    this.lastDoc = doc;
    this.lastEntered = s.enteredGroupId;
    this.layout(doc);
    const fabric = this.fabric;
    const canvas = this.canvas;
    const entered = s.enteredGroupId ? [...(locate(doc, s.enteredGroupId)?.ancestors ?? []), s.enteredGroupId] : [];
    const desired: FObj[] = [];
    const seenObjects = new Set<string>();
    const seenPages = new Set<string>();
    const rebuilt = new Set<string>();
    const measure: DesignOp[] = [];

    // Pranchetas primeiro (fundo), depois os objetos de cada página.
    for (const r of this.pages) {
      const page = doc.pages[r.index]!;
      seenPages.add(page.id);
      const sig = [page.background, r.x, r.y, r.width, r.height];
      let e = this.artboards.get(page.id);
      if (!e || !same(e.sig, sig)) {
        if (e) canvas.remove(e.obj);
        const board = new fabric.Rect({
          left: r.x + r.width / 2,
          top: r.y + r.height / 2,
          originX: "center",
          originY: "center",
          width: r.width,
          height: r.height,
          fill: toFabricPaint(fabric, page.background) ?? "",
          strokeWidth: 0,
          selectable: false,
          evented: false,
          objectCaching: false,
          shadow: new fabric.Shadow({ color: "rgba(0,0,0,0.12)", blur: 24, offsetX: 0, offsetY: 4 }),
        }) as FObj;
        board.__pageId = page.id;
        e = { sig, obj: board };
        this.artboards.set(page.id, e);
      }
      desired.push(e.obj);
    }

    const active = canvas.getActiveObject();
    const activeIds = new Set((active ? canvas.getActiveObjects() : []).map((o) => (o as FObj).__id));
    let selectionTouched = false;

    for (const r of this.pages) {
      const page = doc.pages[r.index]!;
      const visit = (list: DesignObject[], inherited: { opacity: number; hidden: boolean; locked: boolean }) => {
        for (const o of list) {
          if (o.type === "group" && entered.includes(o.id)) {
            visit(o.children, {
              opacity: inherited.opacity * o.opacity,
              hidden: inherited.hidden || !!o.hidden,
              locked: inherited.locked || !!o.locked,
            });
            continue;
          }
          seenObjects.add(o.id);
          const comp = o.type === "instance" ? doc.components.find((c) => c.id === o.componentId) : null;
          const sig = [o, r.x, r.y, inherited.opacity, inherited.hidden, inherited.locked, comp, this.opts.canWrite];
          let e = this.entries.get(o.id);
          const isEditing = this.editing && e?.obj === this.editing;
          if (!e || (!same(e.sig, sig) && !isEditing) || e.sig[0] === null) {
            if (e && activeIds.has(o.id)) selectionTouched = true;
            if (e) canvas.remove(e.obj);
            const obj = createFabricObject(o, {
              fabric,
              doc,
              offset: { x: r.x, y: r.y },
              pageId: page.id,
              ...inherited,
              interactive: this.opts.canWrite,
            });
            e = { sig, obj };
            this.entries.set(o.id, e);
            rebuilt.add(o.id);
            this.watchPending(o, obj);
            if (o.type === "text") measureText(obj, o, measure);
          }
          desired.push(e.obj);
        }
      };
      visit(page.objects, { opacity: 1, hidden: false, locked: false });
    }

    for (const [id, e] of this.entries) {
      if (!seenObjects.has(id)) {
        if (activeIds.has(id)) selectionTouched = true;
        canvas.remove(e.obj);
        this.entries.delete(id);
      }
    }
    for (const [id, e] of this.artboards) {
      if (!seenPages.has(id)) {
        canvas.remove(e.obj);
        this.artboards.delete(id);
      }
    }

    if (selectionTouched && active) canvas.discardActiveObject();
    const current = new Set(canvas._objects);
    const toAdd = desired.filter((o) => !current.has(o));
    if (toAdd.length) canvas.add(...toAdd);
    // Ordem das camadas igual à do documento.
    const extra = canvas._objects.filter((o) => !desired.includes(o));
    canvas._objects = [...desired, ...extra];
    this.applySelection(true);
    canvas.requestRenderAll();
    this.emitViewport();

    if (measure.length) {
      // Medidas reais dos textos (fontes carregadas): ajuste técnico, fora do histórico.
      queueMicrotask(() => this.store.dispatch(measure, { history: false, reason: "silent" }));
    }
  }

  /** Objetos provisórios (imagem carregando, elemento antigo) são trocados assim que ficam prontos. */
  private watchPending(o: DesignObject, obj: FObj) {
    const srcs: string[] = [];
    const walk = (m: DesignObject) => {
      if (m.type === "image") srcs.push(m.src);
      if (m.type === "group") m.children.forEach(walk);
      if (m.type === "instance") {
        const comp = this.store.doc.components.find((c) => c.id === m.componentId);
        comp?.objects.forEach(walk);
        Object.values(m.overrides ?? {}).forEach((ov) => ov.src && srcs.push(ov.src));
      }
    };
    walk(o);
    const pending = hasPending(obj);
    if (o.type === "fabric" && obj.__pending) {
      const r = this.pageRect(obj.__pageId!);
      void enlivenLegacy(o, {
        fabric: this.fabric,
        doc: this.store.doc,
        offset: { x: r?.x ?? 0, y: r?.y ?? 0 },
        pageId: obj.__pageId!,
        opacity: 1,
        hidden: false,
        locked: !!o.locked,
        interactive: this.opts.canWrite,
      }).then((real) => {
        const e = this.entries.get(o.id);
        if (!real || !e || e.obj !== obj || this.disposed) return;
        const i = this.canvas._objects.indexOf(obj);
        this.canvas.remove(obj);
        this.canvas.insertAt(Math.max(0, i), real);
        e.obj = real;
        this.canvas.requestRenderAll();
      });
      return;
    }
    if (!pending) return;
    for (const src of srcs) {
      const set = this.waiting.get(src) ?? new Set();
      set.add(o.id);
      this.waiting.set(src, set);
      void loadImage(src).then((img) => {
        const ids = this.waiting.get(src);
        this.waiting.delete(src);
        if (!ids || this.disposed) return;
        for (const id of ids) {
          const e = this.entries.get(id);
          if (e) e.sig = [null];
        }
        this.lastDoc = null;
        this.sync();
        this.fixNaturalSize(src, img.el, img.missing);
      });
    }
  }

  /** Tamanho original da imagem (documentos antigos não guardavam): ajuste técnico, fora do histórico. */
  private fixNaturalSize(src: string, el: HTMLImageElement, missing: boolean) {
    if (missing || !el.naturalWidth) return;
    const ops: DesignOp[] = [];
    for (const p of this.store.doc.pages) {
      const walk = (list: DesignObject[]) => {
        for (const o of list) {
          if (o.type === "group") walk(o.children);
          if (
            o.type === "image" &&
            o.src === src &&
            (o.naturalWidth !== el.naturalWidth || o.naturalHeight !== el.naturalHeight)
          ) {
            ops.push({
              op: "update",
              id: o.id,
              set: { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight },
            });
          }
        }
      };
      walk(p.objects);
    }
    if (ops.length) this.store.dispatch(ops, { history: false, reason: "silent" });
  }

  /** Seleção do store → seleção do Fabric. */
  private applySelection(force = false) {
    const canvas = this.canvas;
    const ids = this.store.selection;
    const objs = ids
      .map((id) => this.entries.get(id)?.obj)
      .filter((o): o is FObj => !!o && o.visible !== false && !!o.selectable);
    const current = canvas.getActiveObjects() as FObj[];
    const same = objs.length === current.length && objs.every((o, i) => o === current[i]);
    if (same && !force) return;
    if (same && canvas.getActiveObject()) return;
    if (this.editing) return;
    const prev = this.syncing;
    this.syncing = true;
    try {
      if (!objs.length) canvas.discardActiveObject();
      else if (objs.length === 1) canvas.setActiveObject(objs[0]!);
      else {
        canvas.discardActiveObject();
        canvas.setActiveObject(new this.fabric.ActiveSelection(objs, { canvas }));
      }
    } finally {
      this.syncing = prev;
    }
    canvas.requestRenderAll();
  }

  /* ---------------------------------------------------------------- */
  /* Fabric → documento                                                */
  /* ---------------------------------------------------------------- */

  /** Lê a transformação final do objeto (com grupo/seleção) e devolve o objeto do documento atualizado. */
  private readBack(obj: FObj, model: DesignObject, offset: { x: number; y: number }): DesignObject {
    if (model.type === "group") {
      const kids = ((obj as unknown as FabricNS.Group).getObjects?.() ?? []) as FObj[];
      const children = model.children.map((c) => {
        const k = kids.find((x) => x.__id === c.id);
        return k ? this.readBack(k, c, offset) : c;
      });
      return withGroupBox({ ...model, children });
    }
    const m = obj.calcTransformMatrix();
    const fx = obj.flipX ? -1 : 1;
    const fy = obj.flipY ? -1 : 1;
    const d = this.fabric.util.qrDecompose([m[0] * fx, m[1] * fx, m[2] * fy, m[3] * fy, m[4], m[5]]);
    const x = obj;
    const rx = Math.abs(d.scaleX) / (x.__sx0 || 1);
    const ry = Math.abs(d.scaleY) / (x.__sy0 || 1);
    const rotation = round(normalizeRotation(d.angle));
    let next: DesignObject;
    let cx = d.translateX;
    let cy = d.translateY;
    switch (model.type) {
      case "text": {
        const t = obj as unknown as FabricNS.Textbox;
        const scaled = Math.abs(ry - 1) > 1e-3;
        next = {
          ...model,
          text: t.text ?? model.text,
          width: round((t.width ?? model.width) * Math.abs(d.scaleX)),
          height: round((t.height ?? model.height) * Math.abs(d.scaleY)),
          fontSize: scaled ? round(model.fontSize * ry) : model.fontSize,
          rotation,
        };
        if (next.type === "text" && next.text !== model.text) delete next.fabricStyles;
        break;
      }
      case "line":
        next = { ...model, width: round((x.__w0 ?? model.width) * rx), height: 0, rotation };
        break;
      case "fabric":
        next = { ...model };
        break;
      case "path": {
        const p = obj as unknown as FabricNS.Path & { pathOffset: FabricNS.Point };
        const [vx, vy, vw, vh] = model.viewBox;
        next = { ...model, width: round(model.width * rx), height: round(model.height * ry), rotation };
        // O centro do Fabric é o do caminho; o do documento é o do viewBox.
        const sx = vw > 0 ? next.width / vw : 1;
        const sy = vh > 0 ? next.height / vh : 1;
        const off = { x: (p.pathOffset.x - (vx + vw / 2)) * sx, y: (p.pathOffset.y - (vy + vh / 2)) * sy };
        const a = (rotation * Math.PI) / 180;
        cx -= off.x * Math.cos(a) - off.y * Math.sin(a);
        cy -= off.x * Math.sin(a) + off.y * Math.cos(a);
        break;
      }
      default:
        next = {
          ...model,
          width: round((x.__w0 ?? model.width) * rx),
          height: round((x.__h0 ?? model.height) * ry),
          rotation,
        };
    }
    next.x = round(cx - offset.x - next.width / 2);
    next.y = round(cy - offset.y - next.height / 2);
    if (model.type === "fabric") next.rotation = model.rotation;
    return next;
  }

  /** Fim de uma transformação com o mouse/toque: vira um lote de operações. */
  private onModified(target: FObj, action?: string) {
    const doc = this.store.doc;
    const objs = (
      target.type === "activeselection" ? (target as unknown as FabricNS.ActiveSelection).getObjects() : [target]
    ) as FObj[];
    const ops: DesignOp[] = [];
    for (const obj of objs) {
      const id = obj.__id;
      if (!id) continue;
      const loc = locate(doc, id);
      if (!loc?.pageId) continue;
      const src = this.pageRect(loc.pageId);
      if (!src) continue;
      const next = this.readBack(obj, loc.object, src);
      if (JSON.stringify(next) === JSON.stringify(loc.object)) continue;
      ops.push({ op: "replace", id, object: next });
      // Soltou o objeto sobre outra página: ele passa a pertencer a ela (mesma posição na tela).
      if (!loc.ancestors.length) {
        const c = { x: src.x + next.x + next.width / 2, y: src.y + next.y + next.height / 2 };
        const dest = this.pageAt(c);
        if (dest && dest.id !== src.id) {
          ops.push(
            { op: "reparent", id, pageId: dest.id },
            { op: "move", ids: [id], dx: src.x - dest.x, dy: src.y - dest.y },
          );
        }
      }
    }
    if (!ops.length) return;
    const label =
      action?.startsWith("scale") || action === "resizing" ? "Redimensionar" : action === "rotate" ? "Girar" : "Mover";
    this.store.dispatch(ops, { label });
  }

  /* ---------------------------------------------------------------- */
  /* Eventos                                                           */
  /* ---------------------------------------------------------------- */

  private bindEvents() {
    const c = this.canvas;
    const ids = () => (c.getActiveObjects() as FObj[]).map((o) => o.__id).filter((x): x is string => !!x);
    const onSelect = () => {
      if (this.syncing) return;
      this.store.setSelection(ids());
    };
    c.on("selection:created", onSelect);
    c.on("selection:updated", onSelect);
    c.on("selection:cleared", () => {
      if (this.syncing || this.editing) return;
      this.store.setSelection([]);
    });

    c.on("object:modified", (e) => {
      const t = e.target as FObj | undefined;
      // Objeto já substituído (ex.: texto salvo ao sair da edição) não gera outra alteração.
      if (!t || this.syncing || !t.canvas) return;
      if (this.editing && t === this.editing) return;
      this.snapLines = [];
      this.snapCache = null;
      this.onModified(t, (e as { action?: string }).action ?? e.transform?.action);
    });

    c.on("object:moving", (e) => this.snapMoving(e.target as FObj, (e.e as MouseEvent | undefined)?.altKey));
    c.on("object:rotating", (e) => {
      const t = e.target;
      if ((e.e as MouseEvent | undefined)?.shiftKey) t.set({ angle: Math.round(t.angle / 15) * 15 });
    });

    c.on("mouse:over", (e) => {
      const t = e.target as FObj | undefined;
      if (t?.__id && t !== this.hovered) {
        this.hovered = t;
        c.requestRenderAll();
      }
    });
    c.on("mouse:out", (e) => {
      if (e.target && e.target === this.hovered) {
        this.hovered = null;
        c.requestRenderAll();
      }
    });

    c.on("mouse:down", (e) => this.onDown(e));
    c.on("mouse:move", (e) => this.onMove(e));
    c.on("mouse:up", (e) => this.onUp(e));
    c.on("mouse:wheel", (e) => this.onWheel(e.e as WheelEvent));
    c.on("mouse:dblclick", (e) => this.onDblClick(e));

    c.on("text:editing:entered", (e) => {
      this.editing = (e.target as FObj) ?? null;
      this.editingHeight = this.editing?.height ?? 0;
      this.opts.onTextEditing?.(true);
    });
    c.on("text:changed", (e) => {
      // O texto cresce para baixo (o topo fica parado), como numa caixa de texto.
      const t = e.target as FObj;
      const dh = (t.height ?? 0) - this.editingHeight;
      if (!dh) return;
      const a = ((t.angle ?? 0) * Math.PI) / 180;
      const s = t.scaleY ?? 1;
      t.set({ left: (t.left ?? 0) - (Math.sin(a) * dh * s) / 2, top: (t.top ?? 0) + (Math.cos(a) * dh * s) / 2 });
      t.setCoords();
      this.editingHeight = t.height ?? 0;
    });
    c.on("text:editing:exited", (e) => {
      const t = e.target as FObj;
      this.editing = null;
      this.opts.onTextEditing?.(false);
      const id = t.__id;
      const loc = id ? locate(this.store.doc, id) : null;
      if (!loc?.pageId || loc.object.type !== "text") return;
      const r = this.pageRect(loc.pageId);
      if (!r) return;
      const next = this.readBack(t, loc.object, r);
      if (JSON.stringify(next) === JSON.stringify(loc.object)) return;
      this.store.dispatch([{ op: "replace", id: id!, object: next }], { label: "Editar texto" });
    });

    c.on("path:created", (e) => this.onPathCreated((e as unknown as { path: FabricNS.Path }).path));
  }

  private worldPoint(e: { scenePoint?: FabricNS.Point }) {
    return e.scenePoint ?? new this.fabric.Point(0, 0);
  }

  private onDown(e: FabricNS.TPointerEventInfo<FabricNS.TPointerEvent>) {
    const s = this.store;
    const ev = e.e as MouseEvent;
    if (ev.button === 1 || s.tool === "hand" || this.spaceHeld) {
      this.panning = { x: ev.clientX, y: ev.clientY };
      this.canvas.setCursor("grabbing");
      return;
    }
    if (ev.button === 2) return;
    const p = this.worldPoint(e);
    if (s.tool === "select" && !e.target) {
      const guide = this.guideAt(p);
      if (guide && this.opts.canWrite) {
        this.guideDrag = { ...guide, fromRuler: false };
        this.canvas.selection = false;
        return;
      }
      // Clique na prancheta vazia: ativa a página; fora do grupo aberto: fecha o grupo.
      const page = this.pageAt(p);
      if (page) s.setActivePage(page.id);
      if (s.enteredGroupId) s.enterGroup(null);
    }
    if (!this.opts.canWrite) return;
    if (s.tool === "text") {
      const page = this.pageAt(p) ?? this.pageRect(s.activePageId)!;
      this.addTextAt(page, p);
      return;
    }
    if (s.tool === "rect" || s.tool === "ellipse" || s.tool === "line") {
      const page = this.pageAt(p) ?? this.pageRect(s.activePageId)!;
      this.drawingShape = { tool: s.tool, start: p, temp: null, page };
    }
  }

  private onMove(e: FabricNS.TPointerEventInfo<FabricNS.TPointerEvent>) {
    const ev = e.e as MouseEvent;
    if (this.panning) {
      this.panBy(ev.clientX - this.panning.x, ev.clientY - this.panning.y);
      this.panning = { x: ev.clientX, y: ev.clientY };
      return;
    }
    const p = this.worldPoint(e);
    if (this.guideDrag) {
      const page = this.pageRect(this.guideDrag.pageId)!;
      this.guideDrag.value = Math.round(this.guideDrag.axis === "v" ? p.x - page.x : p.y - page.y);
      this.canvas.requestRenderAll();
      return;
    }
    const d = this.drawingShape;
    if (!d) return;
    const fabric = this.fabric;
    const shift = ev.shiftKey;
    if (d.temp) this.canvas.remove(d.temp);
    let x2 = p.x;
    let y2 = p.y;
    if (shift && d.tool !== "line") {
      const size = Math.max(Math.abs(x2 - d.start.x), Math.abs(y2 - d.start.y));
      x2 = d.start.x + Math.sign(x2 - d.start.x || 1) * size;
      y2 = d.start.y + Math.sign(y2 - d.start.y || 1) * size;
    }
    if (shift && d.tool === "line") {
      const ang = Math.round(Math.atan2(y2 - d.start.y, x2 - d.start.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(x2 - d.start.x, y2 - d.start.y);
      x2 = d.start.x + Math.cos(ang) * len;
      y2 = d.start.y + Math.sin(ang) * len;
    }
    const style = {
      fill: "rgba(244,191,47,0.25)",
      stroke: "#d9a21a",
      strokeWidth: 1.5 / this.zoom,
      selectable: false,
      evented: false,
    };
    d.temp =
      d.tool === "line"
        ? (new fabric.Line([d.start.x, d.start.y, x2, y2], { ...style, strokeWidth: 3 / this.zoom }) as FObj)
        : d.tool === "ellipse"
          ? (new fabric.Ellipse({
              ...style,
              left: (d.start.x + x2) / 2,
              top: (d.start.y + y2) / 2,
              originX: "center",
              originY: "center",
              rx: Math.abs(x2 - d.start.x) / 2,
              ry: Math.abs(y2 - d.start.y) / 2,
            }) as FObj)
          : (new fabric.Rect({
              ...style,
              left: (d.start.x + x2) / 2,
              top: (d.start.y + y2) / 2,
              originX: "center",
              originY: "center",
              width: Math.abs(x2 - d.start.x),
              height: Math.abs(y2 - d.start.y),
            }) as FObj);
    (d.temp as FObj & { __end?: { x: number; y: number } }).__end = { x: x2, y: y2 };
    this.canvas.add(d.temp);
    this.canvas.requestRenderAll();
  }

  private onUp(e: FabricNS.TPointerEventInfo<FabricNS.TPointerEvent>) {
    if (this.panning) {
      this.panning = null;
      this.canvas.setCursor(this.store.tool === "hand" || this.spaceHeld ? "grab" : "default");
      return;
    }
    this.snapLines = [];
    this.snapCache = null;
    if (this.guideDrag) {
      this.finishGuideDrag();
      return;
    }
    const d = this.drawingShape;
    if (!d) return;
    this.drawingShape = null;
    const end = (d.temp as (FObj & { __end?: { x: number; y: number } }) | null)?.__end ?? this.worldPoint(e);
    if (d.temp) this.canvas.remove(d.temp);
    const page = d.page;
    const dragged = Math.hypot(end.x - d.start.x, end.y - d.start.y) * this.zoom > 4;
    const size = Math.round(Math.min(page.width, page.height) * 0.25);
    const brand = this.brandStyle();
    let obj: DesignObject;
    if (d.tool === "line") {
      const x1 = d.start.x - page.x;
      const y1 = d.start.y - page.y;
      const x2 = dragged ? end.x - page.x : x1 + size * 1.5;
      const y2 = dragged ? end.y - page.y : y1;
      const len = Math.hypot(x2 - x1, y2 - y1);
      obj = lineObject({
        x: round((x1 + x2) / 2 - len / 2),
        y: round((y1 + y2) / 2),
        width: round(len),
        rotation: round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI),
        stroke: brand.ink,
        strokeWidth: Math.max(2, Math.round(Math.min(page.width, page.height) / 270)),
      });
    } else {
      const w = dragged ? Math.abs(end.x - d.start.x) : size;
      const h = dragged ? Math.abs(end.y - d.start.y) : size;
      const x = dragged ? Math.min(end.x, d.start.x) - page.x : d.start.x - page.x - w / 2;
      const y = dragged ? Math.min(end.y, d.start.y) - page.y : d.start.y - page.y - h / 2;
      const make = d.tool === "ellipse" ? ellipseObject : rectObject;
      obj = make({ x: round(x), y: round(y), width: round(w), height: round(h), fill: brand.accent });
    }
    this.store.dispatch([{ op: "add", pageId: page.id, object: obj }], { select: [obj.id] });
    this.store.setTool("select");
  }

  private onWheel(ev: WheelEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey) {
      const factor = Math.pow(0.998, ev.deltaY * (ev.deltaMode === 1 ? 16 : 1));
      const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
      this.zoomTo(this.zoom * factor, { x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    } else {
      const k = ev.deltaMode === 1 ? 16 : 1;
      this.panBy(
        -(ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX) * k,
        -(ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY) * k,
      );
    }
  }

  private onDblClick(e: FabricNS.TPointerEventInfo<FabricNS.TPointerEvent>) {
    const t = e.target as FObj | undefined;
    const id = t?.__id;
    if (!id || !this.opts.canWrite) return;
    const loc = locate(this.store.doc, id);
    if (loc?.object.type !== "group") return;
    // Abre o grupo e seleciona o filho sob o ponteiro.
    this.store.enterGroup(id);
    const hit = this.canvas.findTarget(e.e) as { target?: FObj } | FObj | undefined;
    const target = (hit && "target" in hit ? hit.target : (hit as FObj | undefined)) as FObj | undefined;
    if (target?.__id && target.__id !== id) this.store.setSelection([target.__id]);
  }

  private onPathCreated(path: FabricNS.Path & { pathOffset: FabricNS.Point }) {
    this.canvas.remove(path as unknown as FObj);
    const center = path.getCenterPoint();
    const page = this.pageAt(center) ?? this.pageRect(this.store.activePageId)!;
    const w = Math.max(1, path.width ?? 1);
    const h = Math.max(1, path.height ?? 1);
    const d = (path.path as unknown as (string | number)[][]).map((seg) => seg.join(" ")).join(" ");
    const brush = this.canvas.freeDrawingBrush;
    const obj = pathObject({
      name: "Desenho",
      d,
      viewBox: [round(path.pathOffset.x - w / 2), round(path.pathOffset.y - h / 2), round(w), round(h)],
      x: round(center.x - page.x - w / 2),
      y: round(center.y - page.y - h / 2),
      width: round(w),
      height: round(h),
      fill: null,
      stroke: (brush?.color as string) ?? "#121110",
      strokeWidth: round(brush?.width ?? 6),
      lineCap: "round",
      lineJoin: "round",
    });
    this.store.dispatch([{ op: "add", pageId: page.id, object: obj }], { label: "Desenhar" });
  }

  private configureBrush() {
    const c = this.canvas;
    if (!c.freeDrawingBrush || !(c.freeDrawingBrush instanceof this.fabric.PencilBrush)) {
      c.freeDrawingBrush = new this.fabric.PencilBrush(c);
    }
    c.freeDrawingBrush.color = this.brushColor;
    c.freeDrawingBrush.width = this.brushWidth;
  }
  brushColor = "#121110";
  brushWidth = 8;
  setBrush(color: string, width: number) {
    this.brushColor = color;
    this.brushWidth = width;
    if (this.canvas.isDrawingMode) this.configureBrush();
  }

  /** Cores da marca para novos elementos (definidas pelo editor). */
  brand = { ink: "#121110", accent: "#F4BF2F", font: "Inter" };
  private brandStyle() {
    return this.brand;
  }

  addTextAt(page: PageRect, p: { x: number; y: number }) {
    const size = Math.round(Math.max(24, page.width * 0.045));
    const width = Math.round(page.width * 0.5);
    const t = textObject({
      name: "Texto",
      text: "Texto",
      x: round(p.x - page.x),
      y: round(p.y - page.y - size * 0.6),
      width,
      fontSize: size,
      fontFamily: this.brand.font,
      color: this.brand.ink,
    });
    this.store.dispatch([{ op: "add", pageId: page.id, object: t }], { select: [t.id], label: "Adicionar texto" });
    this.store.setTool("select");
    this.startEditing(t.id, true);
  }

  /** Entra na edição do texto (seleciona tudo quando é novo). */
  startEditing(id: string, selectAll = false) {
    requestAnimationFrame(() => {
      const obj = this.entries.get(id)?.obj as (FObj & FabricNS.IText) | undefined;
      if (!obj || !("enterEditing" in obj)) return;
      this.canvas.setActiveObject(obj);
      obj.enterEditing();
      if (selectAll) obj.selectAll();
      this.canvas.requestRenderAll();
    });
  }

  isEditingText() {
    return !!this.editing;
  }

  /** Gesto de dois dedos começou: encerra o arraste/seleção em andamento do primeiro dedo. */
  cancelPointer() {
    const c = this.canvas as FCanvas & {
      _groupSelector?: unknown;
      _currentTransform?: unknown;
      endCurrentTransform?: (e?: Event) => void;
    };
    c._groupSelector = null;
    this.drawingShape = null;
    if (c._currentTransform) c.endCurrentTransform?.();
    c.requestRenderAll();
  }

  /** Cor da área de trabalho (acompanha o tema claro/escuro). */
  setWorkspaceColor(color: string) {
    if (!color || color === this.workspaceColor) return;
    this.workspaceColor = color;
    this.canvas.requestRenderAll();
  }

  /** Fontes que terminaram de carregar: os textos com elas são medidos e desenhados de novo. */
  refreshFonts(families: string[]) {
    // As larguras medidas com a fonte alternativa ficam em cache no Fabric: descarta.
    this.fabric.cache.clearFontCache();
    const set = new Set(families);
    let any = false;
    for (const loc of allObjects(this.store.doc)) {
      const o = loc.object;
      if (o.type !== "text" || !set.has(o.fontFamily)) continue;
      const top = loc.ancestors[0] ?? o.id;
      const e = this.entries.get(top) ?? this.entries.get(o.id);
      if (e) {
        e.sig = [null];
        any = true;
      }
    }
    if (any) {
      this.lastDoc = null;
      this.sync();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Alinhamento magnético e guias                                     */
  /* ---------------------------------------------------------------- */

  private snapMoving(target: FObj, disabled?: boolean) {
    if (!this.store.view.snap || disabled) {
      this.snapLines = [];
      return;
    }
    const moving = new Set(
      (target.type === "activeselection" ? (target as unknown as FabricNS.ActiveSelection).getObjects() : [target]).map(
        (o) => o,
      ),
    );
    if (!this.snapCache) {
      const center = target.getCenterPoint();
      const page = this.pageAt(center) ?? this.pageRect(this.store.activePageId);
      if (!page) return;
      const doc = this.store.doc;
      const pageDoc = doc.pages[page.index]!;
      const boxes = [{ x: page.x, y: page.y, width: page.width, height: page.height }];
      for (const [, e] of this.entries) {
        if (moving.has(e.obj) || e.obj.__pageId !== page.id || e.obj.visible === false) continue;
        boxes.push(box(e.obj.getBoundingRect()));
      }
      const guides = {
        v: (pageDoc.guides?.v ?? []).map((g) => g + page.x),
        h: (pageDoc.guides?.h ?? []).map((g) => g + page.y),
      };
      this.snapCache = { targets: snapTargets(boxes, guides), page };
    }
    const moved = box(target.getBoundingRect());
    const { page, targets } = this.snapCache;
    const grid = this.store.view.grid ? this.store.view.gridSize : 0;
    const r = computeSnap(moved, targets, 6 / this.zoom, grid, { x: page.x, y: page.y });
    if (r.dx || r.dy) {
      target.set({ left: (target.left ?? 0) + r.dx, top: (target.top ?? 0) + r.dy });
      target.setCoords();
    }
    this.snapLines = r.lines;
  }

  private guideAt(p: { x: number; y: number }) {
    const tol = 4 / this.zoom;
    for (const r of this.pages) {
      const page = this.store.doc.pages[r.index]!;
      if (p.x < r.x - tol || p.x > r.x + r.width + tol || p.y < r.y - tol || p.y > r.y + r.height + tol) continue;
      const v = (page.guides?.v ?? []).findIndex((g) => Math.abs(r.x + g - p.x) <= tol);
      if (v >= 0) return { pageId: page.id, axis: "v" as const, index: v, value: page.guides!.v[v]! };
      const h = (page.guides?.h ?? []).findIndex((g) => Math.abs(r.y + g - p.y) <= tol);
      if (h >= 0) return { pageId: page.id, axis: "h" as const, index: h, value: page.guides!.h[h]! };
    }
    return null;
  }

  /** Começa a arrastar uma guia nova a partir da régua. */
  beginGuideFromRuler(axis: "v" | "h") {
    if (!this.opts.canWrite) return;
    this.guideDrag = { pageId: this.store.activePageId, axis, index: null, value: -1e9, fromRuler: true };
  }

  /** Durante o arraste a partir da régua (fora dos eventos do Fabric). */
  moveGuideFromRuler(clientX: number, clientY: number) {
    if (!this.guideDrag) return;
    const p = this.clientToWorld(clientX, clientY);
    const page = this.pageRect(this.guideDrag.pageId)!;
    this.guideDrag.value = Math.round(this.guideDrag.axis === "v" ? p.x - page.x : p.y - page.y);
    this.canvas.requestRenderAll();
  }

  finishGuideDrag() {
    const g = this.guideDrag;
    this.guideDrag = null;
    this.canvas.selection = this.opts.canWrite && this.store.tool === "select";
    if (!g) return;
    const page = this.store.doc.pages.find((p) => p.id === g.pageId);
    if (!page) return;
    const size = g.axis === "v" ? page.width : page.height;
    const guides = { v: [...(page.guides?.v ?? [])], h: [...(page.guides?.h ?? [])] };
    const list = guides[g.axis];
    const inside = g.value >= 0 && g.value <= size;
    if (g.index !== null) {
      if (inside) list[g.index] = g.value;
      else list.splice(g.index, 1);
    } else if (inside) list.push(g.value);
    else {
      this.canvas.requestRenderAll();
      return;
    }
    this.store.dispatch([{ op: "updatePage", id: page.id, set: { guides } }], { label: "Guias" });
  }

  /* ---------------------------------------------------------------- */
  /* Desenho por cima (área de trabalho, guias, grade, seleção)         */
  /* ---------------------------------------------------------------- */

  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const vpt = this.canvas.viewportTransform;
    const z = vpt[0];
    const sx = (x: number) => x * z + vpt[4];
    const sy = (y: number) => y * z + vpt[5];
    const W = this.canvas.width ?? 0;
    const H = this.canvas.height ?? 0;
    const doc = this.store.doc;
    const carousel = !!doc.meta?.carousel;
    ctx.save();
    // Área de trabalho: tudo fora das pranchetas (o que passa da borda fica escondido, como na exportação).
    ctx.fillStyle = this.workspaceColor;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    if (carousel && this.pages.length) {
      const first = this.pages[0]!;
      const last = this.pages.at(-1)!;
      ctx.rect(
        sx(first.x),
        sy(0),
        (last.x + last.width - first.x) * z,
        Math.max(...this.pages.map((p) => p.height)) * z,
      );
    } else for (const r of this.pages) ctx.rect(sx(r.x), sy(r.y), r.width * z, r.height * z);
    ctx.fill("evenodd");

    const active = this.pageRect(this.store.activePageId);
    // Carrossel: divisórias entre os slides.
    if (carousel) {
      ctx.strokeStyle = "rgba(217,162,26,0.9)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      for (const r of this.pages.slice(1)) {
        ctx.beginPath();
        ctx.moveTo(Math.round(sx(r.x)) + 0.5, sy(r.y));
        ctx.lineTo(Math.round(sx(r.x)) + 0.5, sy(r.y + r.height));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (active && this.pages.length > 1) {
      ctx.strokeStyle = "#d9a21a";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(active.x) - 1, sy(active.y) - 1, active.width * z + 2, active.height * z + 2);
    }
    // Grade da página ativa.
    if (active && this.store.view.grid) {
      const step = this.store.view.gridSize;
      if (step * z >= 6) {
        ctx.strokeStyle = "rgba(0,0,0,0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = step; x < active.width; x += step) {
          const px = Math.round(sx(active.x + x)) + 0.5;
          ctx.moveTo(px, sy(active.y));
          ctx.lineTo(px, sy(active.y + active.height));
        }
        for (let y = step; y < active.height; y += step) {
          const py = Math.round(sy(active.y + y)) + 0.5;
          ctx.moveTo(sx(active.x), py);
          ctx.lineTo(sx(active.x + active.width), py);
        }
        ctx.stroke();
      }
    }
    // Guias das páginas.
    ctx.strokeStyle = "#0ea5e9";
    ctx.lineWidth = 1;
    for (const r of this.pages) {
      const page = doc.pages[r.index]!;
      const g = page.guides;
      const drag = this.guideDrag && this.guideDrag.pageId === page.id ? this.guideDrag : null;
      const v = (g?.v ?? []).filter((_, i) => !(drag?.axis === "v" && drag.index === i));
      const h = (g?.h ?? []).filter((_, i) => !(drag?.axis === "h" && drag.index === i));
      ctx.beginPath();
      for (const x of v) {
        const px = Math.round(sx(r.x + x)) + 0.5;
        ctx.moveTo(px, sy(r.y));
        ctx.lineTo(px, sy(r.y + r.height));
      }
      for (const y of h) {
        const py = Math.round(sy(r.y + y)) + 0.5;
        ctx.moveTo(sx(r.x), py);
        ctx.lineTo(sx(r.x + r.width), py);
      }
      ctx.stroke();
      if (drag && drag.value > -1e8) {
        ctx.strokeStyle = "#e11d48";
        ctx.beginPath();
        if (drag.axis === "v") {
          const px = Math.round(sx(r.x + drag.value)) + 0.5;
          ctx.moveTo(px, sy(r.y));
          ctx.lineTo(px, sy(r.y + r.height));
        } else {
          const py = Math.round(sy(r.y + drag.value)) + 0.5;
          ctx.moveTo(sx(r.x), py);
          ctx.lineTo(sx(r.x + r.width), py);
        }
        ctx.stroke();
        ctx.fillStyle = "#e11d48";
        ctx.font = "11px sans-serif";
        const label = `${drag.value}`;
        if (drag.axis === "v") ctx.fillText(label, sx(r.x + drag.value) + 4, sy(r.y) + 14);
        else ctx.fillText(label, sx(r.x) + 4, sy(r.y + drag.value) - 4);
        ctx.strokeStyle = "#0ea5e9";
      }
    }
    // Contorno ao passar o mouse.
    const hov = this.hovered;
    if (hov && hov.canvas && !this.canvas.getActiveObjects().includes(hov)) {
      const pts = hov.getCoords();
      ctx.strokeStyle = "#d9a21a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y))));
      ctx.closePath();
      ctx.stroke();
    }
    // Linhas do alinhamento magnético.
    if (this.snapLines.length) {
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const l of this.snapLines) {
        if (l.axis === "x") {
          const px = Math.round(sx(l.at)) + 0.5;
          ctx.moveTo(px, sy(l.start));
          ctx.lineTo(px, sy(l.end));
        } else {
          const py = Math.round(sy(l.at)) + 0.5;
          ctx.moveTo(sx(l.start), py);
          ctx.lineTo(sx(l.end), py);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- */
  /* Zoom e navegação                                                  */
  /* ---------------------------------------------------------------- */

  get zoom() {
    return this.canvas.getZoom();
  }

  onViewport(fn: () => void) {
    this.viewportListeners.add(fn);
    return () => this.viewportListeners.delete(fn);
  }
  private emitViewport() {
    for (const fn of this.viewportListeners) fn();
  }

  setSize(width: number, height: number) {
    this.canvas.setDimensions({ width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) });
    this.canvas.requestRenderAll();
    this.emitViewport();
  }

  zoomTo(z: number, screenPoint?: { x: number; y: number }) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    const p = screenPoint ?? { x: (this.canvas.width ?? 0) / 2, y: (this.canvas.height ?? 0) / 2 };
    this.canvas.zoomToPoint(new this.fabric.Point(p.x, p.y), next);
    this.canvas.requestRenderAll();
    this.emitViewport();
  }

  panBy(dx: number, dy: number) {
    this.canvas.relativePan(new this.fabric.Point(dx, dy));
    this.canvas.requestRenderAll();
    this.emitViewport();
  }

  /** Enquadra uma área do mundo (página, seleção ou tudo) com margem. */
  fitBox(box: { x: number; y: number; width: number; height: number }, pad = 48) {
    const W = this.canvas.width ?? 1;
    const H = this.canvas.height ?? 1;
    const p = Math.min(pad, W * 0.08, H * 0.08);
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((W - p * 2) / box.width, (H - p * 2) / box.height)));
    this.canvas.setViewportTransform([
      z,
      0,
      0,
      z,
      W / 2 - (box.x + box.width / 2) * z,
      H / 2 - (box.y + box.height / 2) * z,
    ]);
    this.canvas.requestRenderAll();
    this.emitViewport();
  }

  fit(target: "page" | "all" | "selection" = "page") {
    if (!this.pages.length) this.layout(this.store.doc);
    if (target === "selection") {
      const a = this.canvas.getActiveObject();
      if (a) return this.fitBox(box(a.getBoundingRect()), 80);
      target = "page";
    }
    if (target === "all") {
      const first = this.pages[0]!;
      const last = this.pages.at(-1)!;
      return this.fitBox({
        x: first.x,
        y: 0,
        width: last.x + last.width - first.x,
        height: Math.max(...this.pages.map((p) => p.height)),
      });
    }
    const r = this.pageRect(this.store.activePageId) ?? this.pages[0]!;
    this.fitBox(r);
  }

  /** Mostra a página (sem mudar o zoom se ela já couber). */
  revealPage(id: string) {
    const r = this.pageRect(id);
    if (!r) return;
    const vpt = this.canvas.viewportTransform;
    const z = vpt[0];
    const W = this.canvas.width ?? 1;
    const H = this.canvas.height ?? 1;
    const left = r.x * z + vpt[4];
    const top = r.y * z + vpt[5];
    if (left >= 0 && top >= 0 && left + r.width * z <= W && top + r.height * z <= H) return;
    if (r.width * z > W || r.height * z > H) return this.fitBox(r);
    this.canvas.setViewportTransform([z, 0, 0, z, W / 2 - (r.x + r.width / 2) * z, H / 2 - (r.y + r.height / 2) * z]);
    this.canvas.requestRenderAll();
    this.emitViewport();
  }

  viewport() {
    const v = this.canvas.viewportTransform;
    return { zoom: v[0], x: v[4], y: v[5], width: this.canvas.width ?? 0, height: this.canvas.height ?? 0 };
  }

  clientToWorld(clientX: number, clientY: number) {
    const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
    const v = this.canvas.viewportTransform;
    return { x: (clientX - rect.left - v[4]) / v[0], y: (clientY - rect.top - v[5]) / v[0] };
  }

  /** Objeto do documento sob um ponto da tela (menu de contexto). */
  hitTest(ev: MouseEvent): string | null {
    const hit = this.canvas.findTarget(ev) as { target?: FObj } | FObj | undefined;
    const target = (hit && "target" in hit ? hit.target : (hit as FObj | undefined)) as FObj | undefined;
    return target?.__id ?? null;
  }

  /** Caixa (na tela) da seleção atual, para barras flutuantes. */
  selectionScreenBox() {
    const a = this.canvas.getActiveObject();
    if (!a) return null;
    const b = a.getBoundingRect();
    const v = this.canvas.viewportTransform;
    return { x: b.left * v[0] + v[4], y: b.top * v[0] + v[5], width: b.width * v[0], height: b.height * v[0] };
  }

  /* ---------------------------------------------------------------- */
  /* Exportação                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Desenha uma página em tamanho real (× escala) num canvas novo. No
   * carrossel entram também os pedaços de objetos das páginas vizinhas que
   * continuam nesta (páginas conectadas).
   */
  renderPage(pageId: string, scale = 1, opts: { background?: string } = {}): HTMLCanvasElement {
    if (this.store.doc !== this.lastDoc) this.sync();
    const r = this.pageRect(pageId);
    if (!r) throw new Error("Página não encontrada.");
    const carousel = !!this.store.doc.meta?.carousel;
    const board = this.artboards.get(pageId)?.obj;
    const shadows = [...this.artboards.values()].map((e) => [e.obj, e.obj.shadow] as const);
    const active = this.canvas.getActiveObject();
    this.exporting = true;
    try {
      for (const [o] of shadows) o.shadow = null;
      const z = this.zoom;
      const v = this.canvas.viewportTransform;
      const out = this.canvas.toCanvasElement(scale / z, {
        left: v[4] + r.x * z,
        top: v[5] + r.y * z,
        width: r.width * z,
        height: r.height * z,
        filter: (o) => {
          const f = o as FObj;
          if (o === board) return true;
          if (!f.__id || f.__pending) return false;
          return carousel || f.__pageId === pageId;
        },
      });
      if (!opts.background) return out;
      const flat = document.createElement("canvas");
      flat.width = out.width;
      flat.height = out.height;
      const ctx = flat.getContext("2d")!;
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(out, 0, 0);
      return flat;
    } finally {
      for (const [o, s] of shadows) o.shadow = s;
      this.exporting = false;
      if (active && !this.canvas.getActiveObject()) this.canvas.setActiveObject(active);
      this.canvas.requestRenderAll();
    }
  }

  /** Miniatura da primeira página (JPEG pequeno) para as listagens. */
  thumbnail(maxSide = 360) {
    const first = this.store.doc.pages[0];
    if (!first) return null;
    try {
      const scale = maxSide / Math.max(first.width, first.height);
      return this.renderPage(first.id, Math.min(1, scale), { background: "#ffffff" }).toDataURL("image/jpeg", 0.72);
    } catch {
      return null;
    }
  }

  /** Para os testes e o chat de edição: id → objeto do Fabric desenhado. */
  fabricObjectOf(id: string) {
    return this.entries.get(id)?.obj ?? null;
  }
}

const box = (b: { left: number; top: number; width: number; height: number }) => ({
  x: b.left,
  y: b.top,
  width: b.width,
  height: b.height,
});

function same(a: unknown[], b: unknown[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function hasPending(obj: FObj): boolean {
  if (obj.__pending) return true;
  const kids = (obj as unknown as { getObjects?: () => FObj[] }).getObjects?.();
  return !!kids?.some(hasPending);
}

/** Compara a altura medida pelo Fabric com a do documento e prepara o ajuste. */
function measureText(obj: FObj, o: Extract<DesignObject, { type: "text" }>, out: DesignOp[]) {
  const h = round(obj.height ?? o.height);
  const w = o.autoWidth ? round(obj.width ?? o.width) : o.width;
  if (Math.abs(h - o.height) < 0.5 && Math.abs(w - o.width) < 0.5 && !o.measure) return;
  const set: Record<string, unknown> = { height: h, width: w };
  if (o.measure === "center") {
    // Documento sem altura salva: mantém o centro onde estava.
    set.y = round(o.y + (o.height - h) / 2);
    set.x = round(o.x + (o.width - w) / 2);
  } else if (o.autoWidth) {
    const align = o.textAlign;
    if (align === "center") set.x = round(o.x + (o.width - w) / 2);
    else if (align === "right") set.x = round(o.x + o.width - w);
  }
  out.push({ op: "update", id: o.id, set, unset: o.measure ? ["measure"] : undefined });
}

export const NEW_ID = newId;
export type { DesignPage };
