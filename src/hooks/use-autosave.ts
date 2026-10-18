"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AutosaveController, type AutosaveState, type SaveOutcome } from "@/lib/autosave/controller";
import { clearLocalDraft, saveLocalDraft } from "@/lib/autosave/local-draft";

export type { AutosaveState, SaveOutcome } from "@/lib/autosave/controller";

type Options = {
  save: () => Promise<SaveOutcome>;
  enabled?: boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  /** Cópia local temporária das alterações não confirmadas (recuperação de rascunho). */
  draft?: { key: string; snapshot: () => unknown; baseRevision: () => number | null };
};

const DRAFT_DEBOUNCE_MS = 400;

/**
 * Salvamento automático para qualquer editor: chame `markDirty()` a cada
 * alteração relevante e `flush()` em ações importantes. O estado exibido é o
 * real — "salvo" só depois da confirmação do servidor.
 */
export function useAutosave(opts: Options) {
  const [controller] = useState(
    () => new AutosaveController({ debounceMs: opts.debounceMs, maxWaitMs: opts.maxWaitMs }),
  );
  const draftRef = useRef(opts.draft);
  const enabledRef = useRef(opts.enabled !== false);
  useEffect(() => {
    controller.setSave(opts.save);
    draftRef.current = opts.draft;
    enabledRef.current = opts.enabled !== false;
  });

  const [state, setState] = useState<AutosaveState>(controller.snapshot);
  useEffect(() => controller.setOnChange(setState), [controller]);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeDraft = useCallback(() => {
    if (!draftRef.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    // Lê o snapshot só quando grava: editores baseados em estado do React já renderizaram a alteração.
    draftTimer.current = setTimeout(() => {
      const d = draftRef.current;
      if (!d) return;
      void saveLocalDraft(d.key, { data: d.snapshot(), baseRevision: d.baseRevision(), savedAt: Date.now() });
    }, DRAFT_DEBOUNCE_MS);
  }, []);

  const markDirty = useCallback(() => {
    if (!enabledRef.current) return;
    controller.markDirty();
    writeDraft();
  }, [controller, writeDraft]);

  // Confirmado pelo servidor e sem nada pendente: a cópia local deixa de ser necessária.
  // (Ao abrir a página o estado inicial é "salvo" sem confirmação: a cópia fica para ser recuperada.)
  useEffect(() => {
    const d = draftRef.current;
    if (state.status === "saved" && state.lastSavedAt !== null && !controller.pending && d) {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      void clearLocalDraft(d.key);
    }
  }, [state.status, state.lastSavedAt, controller]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (controller.pending || controller.snapshot.status === "saving") e.preventDefault();
    };
    const online = () => controller.retry();
    const hidden = () => {
      if (document.visibilityState === "hidden" && controller.pending) void controller.flush();
    };
    const pagehide = () => {
      if (controller.pending) void controller.flush();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("online", online);
    window.addEventListener("pagehide", pagehide);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [controller]);

  useEffect(() => {
    controller.resume();
    return () => controller.dispose();
  }, [controller]);

  return {
    state,
    markDirty,
    flush: useCallback(() => controller.flush(), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
    markSaved: useCallback(() => controller.markSaved(), [controller]),
    conflictResolved: useCallback((o: { pending: boolean }) => controller.conflictResolved(o), [controller]),
    isPending: useCallback(() => controller.pending, [controller]),
  };
}

/** Converte a resposta de uma Server Action no resultado esperado pelo autosave. */
export function outcomeFromAction(
  res: { ok: true } | { ok: false; error: string; code?: string } | null | undefined,
): SaveOutcome {
  if (res?.ok) return { ok: true };
  if (!res) {
    return typeof navigator !== "undefined" && !navigator.onLine
      ? { ok: false, kind: "offline" }
      : { ok: false, kind: "transient", message: "Falha de conexão ao salvar." };
  }
  if (res.code === "conflict") return { ok: false, kind: "conflict", message: res.error };
  if (res.code === "internal" || res.code === "unauthenticated") {
    return { ok: false, kind: "transient", message: res.error };
  }
  return { ok: false, kind: "rejected", message: res.error };
}
