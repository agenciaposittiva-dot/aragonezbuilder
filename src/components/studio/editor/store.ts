"use client";

import { useSyncExternalStore } from "react";
import type { Scene } from "./scene";
import {
  applyOperations,
  DesignOpError,
  labelOf,
  locate,
  type ApplyResult,
  type DesignDocument,
  type DesignOp,
} from "@/lib/design-doc";

/*
 * Estado do editor. O documento é a fonte da verdade; a cena do Fabric só o
 * desenha. Toda alteração passa por operações (lib/design-doc/ops), que dão o
 * desfazer/refazer exato. O estado da interface (seleção, página ativa,
 * ferramenta, grupo aberto) fica aqui e nunca é salvo.
 */

export type Tool = "select" | "hand" | "text" | "rect" | "ellipse" | "line" | "draw";

export type HistoryEntry = {
  label: string;
  ops: DesignOp[];
  inverse: DesignOp[];
  selBefore: string[];
  selAfter: string[];
  pageBefore: string;
  pageAfter: string;
  coalesce?: string;
  at: number;
};

export type DispatchOptions = {
  label?: string;
  /** Agrupa alterações seguidas do mesmo tipo (ex.: arrastar um controle deslizante) numa só entrada do histórico. */
  coalesce?: string;
  /** false = não entra no histórico (ex.: medidas do texto calculadas ao abrir). */
  history?: boolean;
  /** "silent" = ajuste técnico que não precisa ser salvo agora. */
  reason?: "edit" | "silent";
  select?: string[];
};

export type ChangeReason = "edit" | "silent" | "replace" | "history";

const MAX_HISTORY = 200;
const COALESCE_MS = 1200;

export class EditorStore {
  doc: DesignDocument;
  selection: string[] = [];
  activePageId: string;
  /** Grupo aberto para editar os filhos (duplo clique). */
  enteredGroupId: string | null = null;
  tool: Tool = "select";
  past: HistoryEntry[] = [];
  future: HistoryEntry[] = [];
  /** Preferências de visualização (não vão para o documento). */
  view = { grid: false, gridSize: 20, snap: true, rulers: true };
  version = 0;
  private listeners = new Set<() => void>();
  onChange: ((reason: ChangeReason) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  /** Cena desenhada (definida quando o canvas fica pronto). */
  scene: Scene | null = null;

  constructor(doc: DesignDocument) {
    this.doc = doc;
    this.activePageId = doc.pages[0]!.id;
  }

  attachScene(scene: Scene | null) {
    this.scene = scene;
  }

  setHandlers(h: { onChange: EditorStore["onChange"]; onError: EditorStore["onError"] }) {
    this.onChange = h.onChange;
    this.onError = h.onError;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Aplica operações. Devolve null (e avisa) se a operação for inválida. */
  dispatch(ops: DesignOp[], opts: DispatchOptions = {}): ApplyResult | null {
    if (!ops.length) return null;
    let result: ApplyResult;
    try {
      result = applyOperations(this.doc, ops);
    } catch (err) {
      this.onError?.(err instanceof DesignOpError ? err.message : "Não foi possível aplicar a alteração.");
      return null;
    }
    const selBefore = this.selection;
    const pageBefore = this.activePageId;
    this.doc = result.doc;
    if (opts.select) this.selection = opts.select;
    this.cleanSelection();
    if (opts.history !== false) {
      const last = this.past.at(-1);
      const now = Date.now();
      if (opts.coalesce && last?.coalesce === opts.coalesce && now - last.at < COALESCE_MS) {
        last.ops = [...last.ops, ...result.applied];
        last.inverse = [...result.inverse, ...last.inverse];
        last.selAfter = this.selection;
        last.at = now;
      } else {
        this.past.push({
          label: opts.label ?? labelOf(result.applied),
          ops: result.applied,
          inverse: result.inverse,
          selBefore,
          selAfter: this.selection,
          pageBefore,
          pageAfter: this.activePageId,
          coalesce: opts.coalesce,
          at: now,
        });
        if (this.past.length > MAX_HISTORY) this.past.shift();
      }
      this.future = [];
    }
    this.emit();
    this.onChange?.(opts.reason ?? "edit");
    return result;
  }

  /** Arquivos exportados não voltam atrás com desfazer (continuam valendo para o próximo envio). */
  private keepOutputs(before: DesignDocument) {
    const outputs = before.meta?.outputs;
    const pdf = before.meta?.pdfOutputFileId;
    if (!outputs && !pdf) return;
    this.doc = {
      ...this.doc,
      meta: { ...this.doc.meta, ...(outputs ? { outputs } : {}), ...(pdf ? { pdfOutputFileId: pdf } : {}) },
    };
  }

  private travel(from: HistoryEntry[], to: HistoryEntry[], dir: "undo" | "redo") {
    const entry = from.pop();
    if (!entry) return false;
    const before = this.doc;
    try {
      this.doc = applyOperations(this.doc, dir === "undo" ? entry.inverse : entry.ops).doc;
    } catch {
      // O documento mudou por fora (ex.: versão restaurada): o histórico antigo não se aplica mais.
      this.past = [];
      this.future = [];
      this.onError?.("Não foi possível desfazer: o documento mudou. O histórico foi reiniciado.");
      this.emit();
      return false;
    }
    this.keepOutputs(before);
    to.push(entry);
    this.selection = dir === "undo" ? entry.selBefore : entry.selAfter;
    const page = dir === "undo" ? entry.pageBefore : entry.pageAfter;
    if (this.doc.pages.some((p) => p.id === page)) this.activePageId = page;
    this.cleanSelection();
    this.emit();
    this.onChange?.("history");
    return true;
  }

  undo = () => this.travel(this.past, this.future, "undo");
  redo = () => this.travel(this.future, this.past, "redo");
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Troca o documento inteiro (restaurar versão, conflito, rascunho recuperado). */
  replaceDocument(doc: DesignDocument, opts: { resetHistory?: boolean; reason?: ChangeReason } = {}) {
    this.doc = doc;
    if (opts.resetHistory !== false) {
      this.past = [];
      this.future = [];
    }
    if (!doc.pages.some((p) => p.id === this.activePageId)) this.activePageId = doc.pages[0]!.id;
    this.enteredGroupId = null;
    this.cleanSelection();
    this.emit();
    this.onChange?.(opts.reason ?? "replace");
  }

  setSelection(ids: string[]) {
    const same = ids.length === this.selection.length && ids.every((id, i) => id === this.selection[i]);
    if (same) return;
    this.selection = ids;
    // Selecionar um objeto ativa a página dele.
    const first = ids[0] ? locate(this.doc, ids[0]) : null;
    if (first?.pageId) this.activePageId = first.pageId;
    if (
      this.enteredGroupId &&
      ids.length &&
      !ids.every((id) => locate(this.doc, id)?.ancestors.includes(this.enteredGroupId!))
    )
      this.enteredGroupId = null;
    this.emit();
  }

  setActivePage(id: string) {
    if (this.activePageId === id || !this.doc.pages.some((p) => p.id === id)) return;
    this.activePageId = id;
    this.emit();
  }

  enterGroup(id: string | null) {
    if (this.enteredGroupId === id) return;
    this.enteredGroupId = id;
    this.emit();
  }

  setTool(tool: Tool) {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit();
  }

  setView(v: Partial<EditorStore["view"]>) {
    this.view = { ...this.view, ...v };
    this.emit();
  }

  /** Remove da seleção o que não existe mais. */
  private cleanSelection() {
    const next = this.selection.filter((id) => locate(this.doc, id));
    if (next.length !== this.selection.length) this.selection = next;
    if (this.enteredGroupId && !locate(this.doc, this.enteredGroupId)) this.enteredGroupId = null;
  }

  get activePage() {
    return this.doc.pages.find((p) => p.id === this.activePageId) ?? this.doc.pages[0]!;
  }
}

/** Assina o store e re-renderiza quando o valor escolhido muda. */
export function useEditor<T>(store: EditorStore, select: (s: EditorStore) => T): T {
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  void version;
  return select(store);
}
