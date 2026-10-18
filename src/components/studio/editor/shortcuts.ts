"use client";

import { useEffect, useRef } from "react";
import type { EditorActions } from "./actions";
import type { Scene } from "./scene";
import type { EditorStore, Tool } from "./store";

export const SHORTCUTS: [string, string][] = [
  ["V", "Selecionar"],
  ["H / Espaço + arrastar", "Mover a vista"],
  ["T", "Texto"],
  ["R", "Retângulo"],
  ["O", "Elipse"],
  ["L", "Linha"],
  ["P", "Desenho livre"],
  ["Ctrl+Z", "Desfazer"],
  ["Ctrl+Shift+Z / Ctrl+Y", "Refazer"],
  ["Ctrl+C / Ctrl+X / Ctrl+V", "Copiar, recortar e colar"],
  ["Ctrl+D", "Duplicar"],
  ["Delete / Backspace", "Excluir"],
  ["Setas (Shift = 10 px)", "Mover 1 px"],
  ["Ctrl+A", "Selecionar tudo da página"],
  ["Ctrl+G / Ctrl+Shift+G", "Agrupar / desagrupar"],
  ["Ctrl+] / Ctrl+[", "Trazer para frente / enviar para trás"],
  ["Ctrl+Alt+K", "Criar componente"],
  ["Ctrl+Shift+L / Ctrl+Shift+H", "Bloquear / ocultar"],
  ["Ctrl + roda / pinça", "Zoom no ponteiro"],
  ["Ctrl + / Ctrl −", "Aumentar / diminuir zoom"],
  ["Shift+1 / Shift+2 / Shift+0", "Ajustar página / seleção / 100%"],
  ["Enter", "Editar o texto selecionado"],
  ["Esc", "Sair do grupo / limpar seleção"],
  ["Ctrl+S", "Salvar agora"],
  ["Ctrl+E", "Exportar"],
  ["?", "Esta lista"],
];

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  t: "text",
  r: "rect",
  o: "ellipse",
  l: "line",
  p: "draw",
};

/** Atalhos do editor (desligados enquanto se digita num campo ou num texto do canvas). */
export function useShortcuts(o: {
  store: EditorStore;
  scene: () => Scene | null;
  actions: EditorActions;
  canWrite: boolean;
  onSave: () => void;
  onExport: () => void;
  onHelp: () => void;
}) {
  const ref = useRef(o);
  useEffect(() => {
    ref.current = o;
  });

  useEffect(() => {
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable);
    };
    const dialogOpen = () =>
      !!document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open]");

    function onKey(e: KeyboardEvent) {
      const { store, actions, canWrite } = ref.current;
      const scene = ref.current.scene();
      if (typing(e) || dialogOpen()) return;
      if (scene?.isEditingText()) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (e.key === " " && !e.repeat && scene) {
        scene.spaceHeld = true;
        scene.canvas.selection = false;
        scene.canvas.defaultCursor = "grab";
        scene.canvas.setCursor("grab");
        return e.preventDefault();
      }
      if (mod && k === "s") return run(ref.current.onSave);
      if (mod && k === "e") return run(ref.current.onExport);
      if (mod && (k === "=" || k === "+")) return run(() => scene?.zoomTo(scene.zoom * 1.25));
      if (mod && k === "-") return run(() => scene?.zoomTo(scene.zoom / 1.25));
      if (e.shiftKey && (e.code === "Digit1" || k === "!")) return run(() => scene?.fit("page"));
      if (e.shiftKey && (e.code === "Digit2" || k === "@")) return run(() => scene?.fit("selection"));
      if (e.shiftKey && (e.code === "Digit0" || k === ")")) return run(() => scene?.zoomTo(1));
      if (e.key === "?") return run(ref.current.onHelp);
      if (e.key === "Escape") {
        if (store.tool !== "select") return run(() => store.setTool("select"));
        if (store.enteredGroupId) {
          const g = store.enteredGroupId;
          return run(() => {
            store.enterGroup(null);
            store.setSelection([g]);
          });
        }
        if (store.selection.length) return run(() => store.setSelection([]));
        return;
      }
      if (!canWrite) return;
      if (mod && k === "z" && !e.shiftKey) return run(store.undo);
      if ((mod && k === "y") || (mod && e.shiftKey && k === "z")) return run(store.redo);
      if (mod && k === "c") return run(() => void actions.copy());
      if (mod && k === "x") return run(() => void actions.copy(true));
      if (mod && k === "d") return run(actions.duplicate);
      if (mod && k === "a") return run(actions.selectAll);
      if (mod && k === "g") return run(e.shiftKey ? actions.ungroup : actions.group);
      if (mod && e.altKey && k === "k") return run(actions.createComponent);
      if (mod && e.shiftKey && k === "l") return run(() => store.selection.forEach((id) => actions.toggleLocked(id)));
      if (mod && e.shiftKey && k === "h") return run(() => store.selection.forEach((id) => actions.toggleHidden(id)));
      if (mod && e.key === "]") return run(() => actions.reorder(e.shiftKey || e.altKey ? "front" : "forward"));
      if (mod && e.key === "[") return run(() => actions.reorder(e.shiftKey || e.altKey ? "back" : "backward"));
      if ((e.key === "Delete" || e.key === "Backspace") && store.selection.length) return run(actions.remove);
      if (e.key.startsWith("Arrow") && store.selection.length) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        return run(() => actions.nudge(dx, dy));
      }
      if (e.key === "Enter" && store.selection.length === 1 && scene) {
        return run(() => scene.startEditing(store.selection[0]!));
      }
      if (!mod && !e.altKey && TOOL_KEYS[k]) return run(() => store.setTool(TOOL_KEYS[k]!));
    }
    function onKeyUp(e: KeyboardEvent) {
      const scene = ref.current.scene();
      if (e.key === " " && scene?.spaceHeld) {
        scene.spaceHeld = false;
        scene.canvas.selection = ref.current.canWrite && ref.current.store.tool === "select";
        scene.canvas.defaultCursor = "default";
        scene.canvas.setCursor("default");
      }
    }
    function onPaste(e: ClipboardEvent) {
      if (typing(e) || dialogOpen() || !ref.current.canWrite || ref.current.scene()?.isEditingText()) return;
      e.preventDefault();
      void ref.current.actions.paste(e.clipboardData);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}
