"use client";

import {
  AlertTriangle,
  Check,
  Eye,
  ImageIcon,
  MessageSquarePlus,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { AiSelection } from "@/lib/ai-select";
import type { DesignDocument, DesignOp } from "@/lib/design-doc";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { designAiOutcomeAction, designAiSetupAction } from "@/server/actions/design-ai";
import type {
  DesignAiChange,
  DesignAiProposal,
  DesignAiSetup,
  DesignImageEditResult,
} from "@/server/services/design-ai";
import type { DesignAiAction, ImageEditArgs } from "@/server/services/design-ai-tools";

/* ------------------------------------------------------------------ */
/* Contrato com quem hospeda o chat (editor ou Assistente IA)          */
/* ------------------------------------------------------------------ */

export type ApplyOutcome =
  | { ok: true; inverse: DesignOp[] }
  /** `unsaved`: a alteração está na arte aberta, mas não chegou ao servidor. */
  | { ok: false; error: string; unsaved?: boolean; inverse?: DesignOp[] };

export type DesignAiHost = {
  designId: string;
  /** Estado atual: documento do editor (com alterações locais) ou null = o salvo no servidor. */
  context: () => { document: DesignDocument | null; pageId: string | null; selection: string[] };
  /** Onde a pessoa está ("Página 2 de 5 · 1 selecionado"), para mostrar no painel. */
  where?: string | null;
  apply: (ops: DesignOp[], meta: { label: string; revision: number }) => Promise<ApplyOutcome>;
  undo: (inverse: DesignOp[]) => Promise<ApplyOutcome>;
  /** Tenta salvar de novo (editor). */
  retrySave?: () => Promise<boolean>;
  /** Miniaturas antes/depois das páginas afetadas (editor). */
  preview?: (ops: DesignOp[], pages: number[]) => Promise<{ page: number; before: string; after: string }[]>;
  /** Mostra os elementos na arte (seleciona e leva até a página). */
  reveal?: (ids: string[]) => void;
};

type Alternative = { provider: string; providerLabel: string; model: string; label: string };
type Meta = { demo: boolean; providerLabel: string; modelLabel: string; warnings: string[] } | null;

type Status =
  "pending" | "applying" | "saved" | "unsaved" | "failed" | "cancelled" | "undoing" | "undone" | "superseded";

/** Execução de uma ação de ferramenta da proposta (ex.: gerar a nova imagem). */
type ActionRun = {
  /** Instrução editável antes de executar. */
  instruction: string;
  running: boolean;
  error: { message: string; alternatives: Alternative[]; canGenerate: boolean } | null;
  costPrompt: string | null;
  /** Operações que a ação acrescenta à aplicação + dados para a vista. */
  result: { ops: DesignOp[]; generationId: string | null; fileId: string | null; data: unknown } | null;
};

type Proposal = {
  generationId: string;
  revision: number;
  data: DesignAiProposal;
  status: Status;
  error: string | null;
  inverse: DesignOp[] | null;
  previews: { page: number; before: string; after: string }[] | null;
  /** Uma por ação de `data.actions` (mesma ordem). */
  runs: ActionRun[];
};

type RunOptions = { mode?: "edit" | "generate"; confirmCost?: boolean; sel?: AiSelection };
type RunOutcome =
  | { ok: true; result: NonNullable<ActionRun["result"]> }
  | { ok: false; costPrompt: string }
  | { ok: false; error: NonNullable<ActionRun["error"]> };
type RunCtx = {
  orgSlug: string;
  host: DesignAiHost;
  action: DesignAiAction;
  run: ActionRun;
  opts: RunOptions;
  selection: AiSelection;
};

/**
 * Executores das ferramentas (registro em server/services/design-ai-tools).
 * Uma ferramenta nova acrescenta aqui como executar e, em ACTION_VIEWS, como
 * aparece na proposta; o resultado são operações aplicadas como as demais.
 */
const ACTION_EXECUTORS: Record<string, (c: RunCtx) => Promise<RunOutcome>> = {
  image_edit: async ({ orgSlug, host, action, run, opts, selection }) => {
    const args = action.args as ImageEditArgs;
    const ctx = host.context();
    const res = await fetch("/api/designs/ai/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgSlug,
        designId: host.designId,
        objectId: args.targetId,
        instruction: run.instruction.trim(),
        document: ctx.document ?? undefined,
        mode: opts.mode ?? "edit",
        ai: opts.sel ?? selection,
        confirmCost: opts.confirmCost,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: DesignImageEditResult;
      error?: string;
      code?: string;
      alternatives?: Alternative[];
    };
    if (res.ok && json.ok && json.result) {
      const r = json.result;
      return { ok: true, result: { ops: [r.op], generationId: r.generationId, fileId: r.fileId, data: r } };
    }
    if (json.code === "cost_confirmation") return { ok: false, costPrompt: json.error ?? "Confirme o custo." };
    return {
      ok: false,
      error: {
        message: json.error ?? "Não foi possível gerar a nova imagem.",
        alternatives: json.alternatives ?? [],
        canGenerate: json.code === "model_selection" && (opts.mode ?? "edit") === "edit",
      },
    };
  },
};

type Item =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; meta: Meta; proposal: Proposal | null }
  | { id: string; role: "error"; text: string; alternatives: Alternative[]; retry: string | null }
  | { id: string; role: "cost"; text: string; message: string };

const CHECKPOINT = "Antes da edição pelo chat de IA";
const uid = () => Math.random().toString(36).slice(2, 10);

const SUGGESTIONS = [
  "Corrija os erros de português sem mudar o layout",
  "Troque o título por uma frase mais impactante",
  "Deixe a chamada mais comercial",
  "Gere uma nova versão desta imagem mais premium",
];

/**
 * Chat de edição de artes por IA. Entende a página ativa, a seleção e a marca
 * do cliente; cada resposta é uma PROPOSTA com prévia (antes/depois). Nada
 * muda até a pessoa aplicar, e toda alteração aplicada pode ser desfeita.
 */
export function DesignAiChat({ host, className }: { host: DesignAiHost; className?: string }) {
  const { orgSlug } = useWorkspace();
  const [setup, setSetup] = useState<DesignAiSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [toolSelection, setToolSelection] = useState<AiSelection>({ mode: "default" });
  const [showModel, setShowModel] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    void designAiSetupAction(orgSlug, { designId: host.designId })
      .then((res) => {
        if (!alive) return;
        if (res.ok) setSetup(res.data);
        else setSetupError(res.error);
      })
      .catch(() => alive && setSetupError("Falha de conexão ao abrir o chat."));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [orgSlug, host.designId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [items.length, running]);

  const patch = (id: string, fn: (p: Proposal) => Proposal) =>
    setItems((all) =>
      all.map((it) =>
        it.id === id && it.role === "assistant" && it.proposal ? { ...it, proposal: fn(it.proposal) } : it,
      ),
    );

  const ready = setup?.canUse ? setup : null;
  const blocked = !ready || !ready.enabled || !ready.configured || !ready.canEdit;

  /* ---------------------------- envio ---------------------------- */

  async function send(text: string, opts: { confirmCost?: boolean; sel?: AiSelection; retryOf?: string } = {}) {
    const message = text.trim();
    if (!message || running || blocked) return;
    const adjustOf = adjusting;
    setAdjusting(null);
    setInput("");
    const prior = items;
    const userItem: Item = { id: uid(), role: "user", text: message };
    setItems((all) => [
      ...all
        .filter((it) => it.id !== opts.retryOf && it.role !== "cost")
        .map((it) =>
          it.role === "assistant" && it.proposal?.status === "pending"
            ? { ...it, proposal: { ...it.proposal, status: "superseded" as const } }
            : it,
        ),
      ...(prior.some((it) => it.role === "user" && it.text === message && opts.retryOf) ? [] : [userItem]),
    ]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const ctx = host.context();
    const history = prior
      .filter(
        (it): it is Extract<Item, { role: "user" | "assistant" }> => it.role === "user" || it.role === "assistant",
      )
      .slice(-8)
      .map((it) => ({ role: it.role, text: it.text.slice(0, 1500) }));
    try {
      const res = await fetch("/api/designs/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgSlug,
          designId: host.designId,
          message: adjustOf ? `Ajuste na proposta anterior: ${message}` : message,
          history,
          document: ctx.document ?? undefined,
          pageId: ctx.pageId ?? undefined,
          selection: ctx.selection,
          ai: opts.sel ?? selection,
          confirmCost: opts.confirmCost,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: DesignAiProposal;
        meta?: Meta;
        generationId?: string;
        revision?: number;
        error?: string;
        code?: string;
        alternatives?: Alternative[];
      };
      if (res.ok && json.ok && json.result) {
        const data = json.result;
        const reply = [data.reply, data.question].filter(Boolean).join("\n\n");
        const hasWork = data.ops.length > 0 || data.actions.length > 0;
        const id = uid();
        setItems((all) => [
          ...all,
          {
            id,
            role: "assistant",
            text: reply,
            meta: json.meta ?? null,
            proposal: hasWork
              ? {
                  generationId: json.generationId!,
                  revision: json.revision ?? 1,
                  data,
                  status: "pending",
                  error: null,
                  inverse: null,
                  previews: null,
                  runs: data.actions.map((a) => ({
                    instruction: typeof a.args.instruction === "string" ? a.args.instruction : "",
                    running: false,
                    error: null,
                    costPrompt: null,
                    result: null,
                  })),
                }
              : null,
          },
        ]);
        if (data.ops.length && host.preview && data.pages.length) {
          void host
            .preview(data.ops, data.pages)
            .then((previews) => patch(id, (p) => ({ ...p, previews })))
            .catch(() => undefined);
        }
        return;
      }
      if (json.code === "cost_confirmation") {
        setItems((all) => [...all, { id: uid(), role: "cost", text: json.error ?? "Confirme o custo.", message }]);
        return;
      }
      setItems((all) => [
        ...all,
        {
          id: uid(),
          role: "error",
          text: json.error ?? "Não foi possível gerar a proposta.",
          alternatives: json.alternatives ?? [],
          retry: res.status >= 500 || json.code === "provider_error" ? message : null,
        },
      ]);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setItems((all) => [
          ...all,
          { id: uid(), role: "error", text: "Pedido cancelado.", alternatives: [], retry: message },
        ]);
      } else {
        setItems((all) => [
          ...all,
          { id: uid(), role: "error", text: "Falha de conexão. Nada foi alterado.", alternatives: [], retry: message },
        ]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  /* ---------------------------- aplicar / desfazer ---------------------------- */

  function opsOf(p: Proposal): DesignOp[] {
    return [...p.data.ops, ...p.runs.flatMap((r) => r.result?.ops ?? [])];
  }

  function outcome(p: Proposal, value: "applied" | "cancelled" | "undone") {
    const ids = [p.generationId, ...p.runs.map((r) => r.result?.generationId)].filter((x): x is string => !!x);
    for (const generationId of ids)
      void designAiOutcomeAction(orgSlug, { generationId, outcome: value }).catch(() => null);
  }

  async function apply(itemId: string, p: Proposal) {
    const ops = opsOf(p);
    if (!ops.length) return;
    patch(itemId, (x) => ({ ...x, status: "applying", error: null }));
    const label = `Chat de IA: ${p.data.summary[0] ?? "edição"}${p.data.summary.length > 1 ? ` (+${p.data.summary.length - 1})` : ""}`;
    const out = await host
      .apply(ops, { label, revision: p.revision })
      .catch((): ApplyOutcome => ({ ok: false, error: "Falha de conexão. Nada foi alterado." }));
    if (out.ok) {
      patch(itemId, (x) => ({ ...x, status: "saved", inverse: out.inverse }));
      outcome(p, "applied");
    } else if (out.unsaved) {
      patch(itemId, (x) => ({ ...x, status: "unsaved", inverse: out.inverse ?? null, error: out.error }));
    } else {
      patch(itemId, (x) => ({ ...x, status: "failed", error: out.error }));
    }
  }

  async function retrySave(itemId: string, p: Proposal) {
    if (!host.retrySave) return;
    patch(itemId, (x) => ({ ...x, status: "applying" }));
    const ok = await host.retrySave().catch(() => false);
    patch(itemId, (x) => ({
      ...x,
      status: ok ? "saved" : "unsaved",
      error: ok ? null : "Ainda não foi possível salvar. Verifique a conexão.",
    }));
    if (ok) outcome(p, "applied");
  }

  async function undo(itemId: string, p: Proposal) {
    if (!p.inverse?.length) return;
    patch(itemId, (x) => ({ ...x, status: "undoing", error: null }));
    const out = await host
      .undo(p.inverse)
      .catch((): ApplyOutcome => ({ ok: false, error: "Falha de conexão. A alteração continua aplicada." }));
    if (out.ok) {
      patch(itemId, (x) => ({ ...x, status: "undone", inverse: null }));
      outcome(p, "undone");
    } else if (out.unsaved) {
      patch(itemId, (x) => ({ ...x, status: "undone", inverse: null, error: out.error }));
    } else {
      patch(itemId, (x) => ({ ...x, status: "saved", error: out.error }));
    }
  }

  function cancel(itemId: string, p: Proposal) {
    patch(itemId, (x) => ({ ...x, status: "cancelled" }));
    outcome(p, "cancelled");
  }

  /* ---------------------------- ações de ferramentas ---------------------------- */

  const patchRun = (itemId: string, index: number, fn: (r: ActionRun) => ActionRun) =>
    patch(itemId, (x) => ({ ...x, runs: x.runs.map((r, i) => (i === index ? fn(r) : r)) }));

  async function runAction(itemId: string, p: Proposal, index: number, opts: RunOptions = {}) {
    const action = p.data.actions[index];
    const run = p.runs[index];
    const exec = action ? ACTION_EXECUTORS[action.tool] : undefined;
    if (!action || !run || !exec) return;
    patchRun(itemId, index, (r) => ({ ...r, running: true, error: null, costPrompt: null }));
    const out = await exec({ orgSlug, host, action, run, opts, selection: toolSelection }).catch((): RunOutcome => ({
      ok: false,
      error: { message: "Falha de conexão. Nada foi alterado.", alternatives: [], canGenerate: false },
    }));
    patchRun(itemId, index, (r) => ({
      ...r,
      running: false,
      result: out.ok ? out.result : r.result,
      costPrompt: !out.ok && "costPrompt" in out ? out.costPrompt : null,
      error: !out.ok && "error" in out ? out.error : null,
    }));
  }

  /* ---------------------------- interface ---------------------------- */

  const placeholder = adjusting
    ? "O que ajustar nesta proposta?"
    : "Ex.: “Corrija os erros de português” ou “Troque o título do slide 2”";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid="design-ai-chat">
      <div className="grid gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent-text" />
          <p className="text-sm font-semibold">Chat de edição com IA</p>
          {ready?.demo ? <Badge tone="info">Demonstração</Badge> : null}
          <span className="flex-1" />
          {ready?.history.length ? (
            <Button variant="ghost" size="xs" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              Anteriores ({ready.history.length})
            </Button>
          ) : null}
        </div>
        {host.where ? <p className="text-xs text-fg-subtle">{host.where}</p> : null}
        <SetupNotice setup={setup} error={setupError} />
        {showHistory && ready ? <PastRequests items={ready.history} /> : null}
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 scrollbar-thin space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {!items.length && ready && !blocked ? (
          <div className="grid gap-2">
            <p className="text-xs text-fg-muted">
              Peça alterações em textos, cores, posições ou imagens desta arte. Você vê a prévia antes de aplicar e pode
              desfazer depois.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-left text-xs text-fg-muted hover:border-accent hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {items.map((it) =>
          it.role === "user" ? (
            <div key={it.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap text-accent-soft-fg">
                {it.text}
              </p>
            </div>
          ) : it.role === "assistant" ? (
            <div key={it.id} className="grid gap-2" data-testid="design-ai-reply">
              <p className="max-w-[95%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap">
                {it.text}
              </p>
              {it.meta && !it.meta.demo ? (
                <p className="text-[11px] text-fg-subtle">
                  {it.meta.modelLabel} · {it.meta.providerLabel}
                </p>
              ) : null}
              {it.proposal ? (
                <ProposalCard
                  p={it.proposal}
                  setup={ready}
                  host={host}
                  toolSelection={toolSelection}
                  onToolSelection={setToolSelection}
                  onApply={() => void apply(it.id, it.proposal!)}
                  onCancel={() => cancel(it.id, it.proposal!)}
                  onUndo={() => void undo(it.id, it.proposal!)}
                  onRetrySave={() => void retrySave(it.id, it.proposal!)}
                  onAdjust={() => {
                    setAdjusting(it.id);
                    inputRef.current?.focus();
                  }}
                  onRunPatch={(i, fn) => patchRun(it.id, i, fn)}
                  onRun={(i, o) => void runAction(it.id, it.proposal!, i, o)}
                />
              ) : null}
            </div>
          ) : it.role === "cost" ? (
            <div
              key={it.id}
              role="alert"
              className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-sm"
            >
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {it.text}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void send(it.message, { confirmCost: true, retryOf: it.id })}
                >
                  Confirmar e enviar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setItems((all) => all.filter((x) => x.id !== it.id))}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div
              key={it.id}
              role="alert"
              className="grid gap-2 rounded-lg border border-danger/30 bg-danger-soft/40 p-3 text-sm"
            >
              <p className="flex items-start gap-2 text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {it.text}
              </p>
              {it.alternatives.length || it.retry ? (
                <div className="flex flex-wrap gap-1.5">
                  {it.alternatives.map((a) => (
                    <Button
                      key={`${a.provider}:${a.model}`}
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        const next: AiSelection = { mode: "manual", provider: a.provider, model: a.model };
                        setSelection(next);
                        const last = [...items].reverse().find((x) => x.role === "user");
                        if (last && last.role === "user") void send(last.text, { sel: next, retryOf: it.id });
                      }}
                    >
                      Usar {a.label} ({a.providerLabel})
                    </Button>
                  ))}
                  {it.retry ? (
                    <Button size="xs" variant="secondary" onClick={() => void send(it.retry!, { retryOf: it.id })}>
                      <RotateCcw /> Tentar de novo
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ),
        )}
        {running ? (
          <p className="flex items-center gap-2 text-xs text-fg-muted" data-testid="design-ai-running">
            <Spinner /> Analisando a arte e preparando a proposta…
            <Button size="xs" variant="ghost" onClick={() => abortRef.current?.abort()}>
              Cancelar
            </Button>
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 border-t border-border p-3">
        {ready && showModel ? (
          <AiModelPicker
            providers={ready.picker.providers}
            preferences={ready.picker.preferences}
            task="design_edit"
            module="editor"
            value={selection}
            onChange={setSelection}
            disabled={running}
          />
        ) : null}
        {adjusting ? (
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <MessageSquarePlus className="size-3.5" /> Pedindo ajuste na proposta
            <button type="button" className="underline" onClick={() => setAdjusting(null)}>
              cancelar
            </button>
          </p>
        ) : null}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={placeholder}
            disabled={blocked}
            aria-label="Mensagem para o chat de IA"
            data-testid="design-ai-input"
            className="max-h-40 min-h-[44px] flex-1 resize-none text-sm"
          />
          <Button
            type="submit"
            variant="accent"
            size="icon"
            disabled={blocked || running || !input.trim()}
            aria-label="Enviar"
            data-testid="design-ai-send"
          >
            {running ? <Spinner /> : <SendHorizontal />}
          </Button>
        </form>
        <div className="flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
          <span>Enter envia · Shift+Enter quebra a linha</span>
          {ready ? (
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => setShowModel((v) => !v)}
            >
              {showModel ? "Ocultar modelo" : "Modelo de IA"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

function SetupNotice({ setup, error }: { setup: DesignAiSetup | null; error: string | null }) {
  const { orgSlug } = useWorkspace();
  if (error) return <Notice tone="warning">{error}</Notice>;
  if (!setup)
    return (
      <p className="flex items-center gap-2 text-xs text-fg-muted">
        <Spinner /> Carregando…
      </p>
    );
  if (!setup.canUse) return <Notice tone="warning">Seu papel não permite usar o assistente de IA.</Notice>;
  if (!setup.canEdit)
    return <Notice tone="warning">Você pode ver esta arte, mas não tem permissão para editá-la.</Notice>;
  if (!setup.enabled) return <Notice tone="warning">O assistente de IA está desativado nesta organização.</Notice>;
  if (!setup.configured)
    return (
      <Notice tone="warning">
        Nenhum provedor de IA está pronto. Um administrador pode configurar em{" "}
        <Link className="underline" href={`/w/${orgSlug}/settings/ai`}>
          Configurações → Inteligência artificial
        </Link>
        .
      </Notice>
    );
  if (setup.demo)
    return (
      <Notice>
        <ShieldCheck className="size-3.5 shrink-0" /> Modo demonstração: as propostas são montadas localmente, sem
        enviar nada a terceiros.
      </Notice>
    );
  if (setup.hasClient && !setup.allowClientContext)
    return (
      <Notice tone="warning">
        A política da organização não permite enviar dados de clientes ao provedor. Um administrador pode liberar em
        Configurações → Inteligência artificial.
      </Notice>
    );
  return (
    <Notice>
      <ShieldCheck className="size-3.5 shrink-0" /> Vão ao provedor os textos e a estrutura desta arte (e as cores da
      marca do cliente). Nada muda sem a sua confirmação.
    </Notice>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "warning" }) {
  return (
    <p
      className={
        tone === "warning"
          ? "flex items-start gap-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-warning"
          : "flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-fg-muted"
      }
    >
      {tone === "warning" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : null}
      <span className="flex min-w-0 flex-wrap items-center gap-1">{children}</span>
    </p>
  );
}

const OUTCOME_LABEL = { applied: "aplicada", cancelled: "cancelada", undone: "desfeita" } as const;

function PastRequests({ items }: { items: Extract<DesignAiSetup, { canUse: true }>["history"] }) {
  return (
    <ul
      className="grid max-h-56 scrollbar-thin gap-2 overflow-y-auto rounded-md border border-border p-2"
      data-testid="design-ai-history"
    >
      {[...items].reverse().map((h) => (
        <li key={h.id} className="grid gap-0.5 border-b border-border/60 pb-1.5 text-xs last:border-0 last:pb-0">
          <span className="font-medium">{h.message}</span>
          {h.reply ? <span className="text-fg-muted">{h.reply}</span> : null}
          <span className="text-[11px] text-fg-subtle">
            {h.kind === "image_edit" ? "Imagem · " : ""}
            {h.userName ?? "—"} · {formatDateTime(h.createdAt)}
            {h.outcome ? ` · ${OUTCOME_LABEL[h.outcome]}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Proposta                                                            */
/* ------------------------------------------------------------------ */

const STATUS_BADGE: Partial<
  Record<Status, { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string }>
> = {
  applying: { tone: "info", label: "Aplicando…" },
  saved: { tone: "success", label: "Salvo" },
  unsaved: { tone: "danger", label: "Erro ao salvar" },
  failed: { tone: "danger", label: "Não aplicada" },
  cancelled: { tone: "neutral", label: "Cancelada" },
  undoing: { tone: "info", label: "Desfazendo…" },
  undone: { tone: "neutral", label: "Desfeita" },
  superseded: { tone: "neutral", label: "Substituída" },
};

function ProposalCard({
  p,
  setup,
  host,
  toolSelection,
  onToolSelection,
  onApply,
  onCancel,
  onUndo,
  onRetrySave,
  onAdjust,
  onRunPatch,
  onRun,
}: {
  p: Proposal;
  setup: Extract<DesignAiSetup, { canUse: true }> | null;
  host: DesignAiHost;
  toolSelection: AiSelection;
  onToolSelection: (s: AiSelection) => void;
  onApply: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRetrySave: () => void;
  onAdjust: () => void;
  onRunPatch: (index: number, fn: (r: ActionRun) => ActionRun) => void;
  onRun: (index: number, o: RunOptions) => void;
}) {
  const { orgSlug } = useWorkspace();
  const { data } = p;
  const badge = STATUS_BADGE[p.status];
  const pending = p.status === "pending";
  const runOps = p.runs.reduce((n, r) => n + (r.result?.ops.length ?? 0), 0);
  const canApply = pending && data.ops.length + runOps > 0;
  const targets = [...new Set(data.ops.flatMap(opTargets))];
  const files = p.runs.map((r) => r.result?.fileId).filter((x): x is string => !!x);
  const pagesLabel = data.pages.length
    ? data.pages.length === 1
      ? `Página ${data.pages[0]}`
      : `Páginas ${data.pages.join(", ")}`
    : null;

  return (
    <div
      className={cn(
        "grid gap-2.5 rounded-lg border bg-surface p-3",
        p.status === "unsaved" || p.status === "failed" ? "border-danger/40" : "border-border",
      )}
      data-testid="design-ai-proposal"
      data-status={p.status}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Proposta</p>
        {pagesLabel ? <Badge tone="outline">{pagesLabel}</Badge> : null}
        {badge ? (
          <Badge tone={badge.tone} data-testid="design-ai-status">
            {p.status === "applying" || p.status === "undoing" ? <Spinner className="size-3" /> : null}
            {p.status === "saved" ? <Check /> : null}
            {badge.label}
          </Badge>
        ) : null}
      </div>

      {p.previews?.length ? (
        <div className="grid gap-2">
          {p.previews.map((pv) => (
            <div key={pv.page} className="grid grid-cols-2 gap-2" data-testid="design-ai-preview">
              <figure className="grid gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pv.before}
                  alt={`Página ${pv.page} antes`}
                  className="w-full rounded border border-border bg-white object-contain"
                />
                <figcaption className="text-[11px] text-fg-subtle">Antes</figcaption>
              </figure>
              <figure className="grid gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pv.after}
                  alt={`Página ${pv.page} depois`}
                  className="w-full rounded border border-accent/50 bg-white object-contain"
                />
                <figcaption className="text-[11px] text-fg-subtle">Depois</figcaption>
              </figure>
            </div>
          ))}
        </div>
      ) : null}

      {data.changes.length ? (
        <ul className="grid gap-1.5">
          {data.changes.slice(0, 12).map((c, i) => (
            <ChangeRow key={i} c={c} />
          ))}
          {data.changes.length > 12 ? (
            <li className="text-[11px] text-fg-subtle">+ {data.changes.length - 12} alteração(ões)</li>
          ) : null}
        </ul>
      ) : data.summary.length ? (
        <ul className="list-disc pl-4 text-xs text-fg-muted">
          {data.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : null}

      {data.removes ? (
        <p className="flex items-start gap-1.5 rounded-md bg-danger-soft/60 px-2 py-1.5 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Esta proposta remove {data.removes} elemento(s) da
          arte. Confirme só se for isso mesmo (dá para desfazer).
        </p>
      ) : null}
      {data.skipped ? (
        <p className="text-[11px] text-fg-subtle">
          {data.skipped} sugestão(ões) do modelo foram ignoradas por não se aplicarem a esta arte.
        </p>
      ) : null}

      {data.actions.map((action, i) => {
        const View = ACTION_VIEWS[action.tool] ?? UnknownActionView;
        return (
          <View
            key={i}
            action={action}
            run={p.runs[i]!}
            pending={pending}
            setup={setup}
            selection={toolSelection}
            onSelection={onToolSelection}
            onPatch={(fn) => onRunPatch(i, fn)}
            onRun={(o) => onRun(i, o)}
          />
        );
      })}

      {p.error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {p.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {pending ? (
          <>
            <Button
              size="sm"
              variant={data.removes ? "danger" : "primary"}
              onClick={onApply}
              disabled={!canApply}
              data-testid="design-ai-apply"
            >
              <Check /> {data.removes ? "Confirmar e aplicar" : "Aplicar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} data-testid="design-ai-cancel">
              <X /> Cancelar
            </Button>
            <Button size="sm" variant="ghost" onClick={onAdjust}>
              <MessageSquarePlus /> Pedir ajuste
            </Button>
            {host.reveal && targets.length ? (
              <Button size="sm" variant="ghost" onClick={() => host.reveal!(targets)}>
                <Eye /> Mostrar na arte
              </Button>
            ) : null}
          </>
        ) : null}
        {p.status === "saved" && p.inverse?.length ? (
          <Button size="sm" variant="secondary" onClick={onUndo} data-testid="design-ai-undo">
            <Undo2 /> Desfazer
          </Button>
        ) : null}
        {p.status === "unsaved" ? (
          <>
            {host.retrySave ? (
              <Button size="sm" variant="secondary" onClick={onRetrySave} data-testid="design-ai-retry-save">
                <RotateCcw /> Tentar salvar de novo
              </Button>
            ) : null}
            {p.inverse?.length ? (
              <Button size="sm" variant="ghost" onClick={onUndo}>
                <Undo2 /> Desfazer
              </Button>
            ) : null}
          </>
        ) : null}
        {p.status === "failed" ? (
          <Button size="sm" variant="secondary" onClick={onApply} data-testid="design-ai-retry">
            <RotateCcw /> Tentar de novo
          </Button>
        ) : null}
        {p.status === "saved" ? (
          <span className="text-[11px] text-fg-subtle">A versão anterior ficou no histórico (“{CHECKPOINT}”).</span>
        ) : null}
        {p.status === "cancelled" && files.length ? (
          <span className="text-[11px] text-fg-subtle">
            O arquivo gerado continua em{" "}
            <Link className="underline" href={`/w/${orgSlug}/files/${files[0]}`}>
              Arquivos
            </Link>
            .
          </span>
        ) : null}
      </div>
    </div>
  );
}

function opTargets(op: DesignOp): string[] {
  const o = op as { id?: unknown; ids?: unknown };
  if (Array.isArray(o.ids)) return o.ids.filter((x): x is string => typeof x === "string");
  return typeof o.id === "string" ? [o.id] : [];
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v.length > 220 ? `${v.slice(0, 220)}…` : v;
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return v ? "sim" : "não";
  return "(alterado)";
}

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);

function ChangeRow({ c }: { c: DesignAiChange }) {
  const text = c.field === "Texto";
  return (
    <li className="grid gap-0.5 rounded-md bg-surface-2 px-2 py-1.5 text-xs" data-testid="design-ai-change">
      <span className="text-[11px] text-fg-subtle">
        {c.label} · {c.field}
      </span>
      {text ? (
        <>
          <span className="text-fg-muted line-through decoration-danger/60" data-testid="design-ai-before">
            {show(c.before)}
          </span>
          <span className="font-medium" data-testid="design-ai-after">
            {show(c.after)}
          </span>
        </>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          {isColor(c.before) ? <Swatch color={c.before} /> : null}
          <span className="text-fg-muted">{show(c.before)}</span>→{isColor(c.after) ? <Swatch color={c.after} /> : null}
          <span className="font-medium">{show(c.after)}</span>
        </span>
      )}
    </li>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="inline-block size-3 rounded-sm border border-border" style={{ background: color }} />;
}

/* ------------------------------------------------------------------ */
/* Vistas das ações de ferramentas                                     */
/* ------------------------------------------------------------------ */

type ActionViewProps = {
  action: DesignAiAction;
  run: ActionRun;
  pending: boolean;
  setup: Extract<DesignAiSetup, { canUse: true }> | null;
  selection: AiSelection;
  onSelection: (s: AiSelection) => void;
  onPatch: (fn: (r: ActionRun) => ActionRun) => void;
  onRun: (o: RunOptions) => void;
};

/** Como cada ferramenta aparece na proposta (registro em design-ai-tools). */
const ACTION_VIEWS: Record<string, (props: ActionViewProps) => React.ReactNode> = {
  image_edit: ImageEditView,
};

function UnknownActionView({ action }: ActionViewProps) {
  return (
    <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-fg-muted">
      {action.label}: esta ação ainda não pode ser executada nesta tela.
    </p>
  );
}

function ImageEditView({ action, run, pending, setup, selection, onSelection, onPatch, onRun }: ActionViewProps) {
  const { orgSlug } = useWorkspace();
  const [pickModel, setPickModel] = useState(false);
  const args = action.args as ImageEditArgs;
  const result = (run.result?.data ?? null) as DesignImageEditResult | null;
  const canFiles = setup?.canSaveFiles ?? false;
  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border p-2.5" data-testid="design-ai-image">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <ImageIcon className="size-3.5" /> {action.label}
      </p>
      {action.note ? <p className="text-xs text-warning">{action.note}</p> : null}
      {!canFiles ? (
        <p className="text-xs text-warning">Você não tem permissão para salvar imagens em Arquivos.</p>
      ) : null}
      {action.available && canFiles ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <figure className="grid gap-1">
              {args.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={args.src}
                  alt="Imagem atual"
                  className="aspect-square w-full rounded border border-border bg-surface-2 object-contain"
                />
              ) : null}
              <figcaption className="text-[11px] text-fg-subtle">Atual (continua em Arquivos)</figcaption>
            </figure>
            <figure className="grid gap-1">
              {result ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.src}
                  alt="Nova versão"
                  className="aspect-square w-full rounded border border-accent/50 bg-surface-2 object-contain"
                  data-testid="design-ai-image-result"
                />
              ) : (
                <div className="grid aspect-square w-full place-items-center rounded border border-border bg-surface-2 text-[11px] text-fg-subtle">
                  {run.running ? <Spinner /> : "Ainda não gerada"}
                </div>
              )}
              <figcaption className="text-[11px] text-fg-subtle">Nova versão</figcaption>
            </figure>
          </div>
          {pending && !result ? (
            <>
              <Textarea
                value={run.instruction}
                onChange={(e) => {
                  const instruction = e.target.value;
                  onPatch((r) => ({ ...r, instruction }));
                }}
                rows={2}
                maxLength={2000}
                aria-label="O que mudar na imagem"
                className="text-xs"
              />
              {pickModel && setup ? (
                <AiModelPicker
                  providers={setup.picker.providers}
                  preferences={setup.picker.preferences}
                  task="image_edit"
                  module="editor"
                  value={selection}
                  onChange={onSelection}
                  disabled={run.running}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => onRun({})}
                  loading={run.running}
                  disabled={run.running || run.instruction.trim().length < 3}
                  data-testid="design-ai-image-generate"
                >
                  <Sparkles /> {run.running ? "Gerando…" : "Gerar nova versão"}
                </Button>
                <button
                  type="button"
                  className="text-[11px] text-fg-subtle underline"
                  onClick={() => setPickModel((v) => !v)}
                >
                  {pickModel ? "Ocultar modelo" : "Modelo de imagem"}
                </button>
              </div>
              <p className="text-[11px] text-fg-subtle">
                A imagem atual vai como referência para o modelo de edição. O resultado é salvo em Arquivos como arquivo
                novo; nada muda na arte até você aplicar.
              </p>
            </>
          ) : null}
          {result ? (
            <p className="text-[11px] text-fg-subtle">
              {result.demo
                ? "Exemplo (modo demonstração): ajuste local de cores, sem IA real. "
                : `${result.modelLabel} · ${result.providerLabel}. `}
              Salva em{" "}
              <Link className="underline" href={`/w/${orgSlug}/files/${result.fileId}`}>
                Arquivos
              </Link>
              {result.mode === "generate" ? " (imagem nova, sem usar a original)." : "."}
            </p>
          ) : null}
          {run.costPrompt ? (
            <div role="alert" className="grid gap-1.5 rounded-md bg-warning-soft/50 p-2 text-xs">
              <span>{run.costPrompt}</span>
              <span className="flex gap-1.5">
                <Button size="xs" variant="primary" onClick={() => onRun({ confirmCost: true })}>
                  Confirmar e gerar
                </Button>
                <Button size="xs" variant="ghost" onClick={() => onPatch((r) => ({ ...r, costPrompt: null }))}>
                  Cancelar
                </Button>
              </span>
            </div>
          ) : null}
          {run.error ? (
            <div role="alert" className="grid gap-1.5 text-xs text-danger" data-testid="design-ai-image-error">
              <span className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {run.error.message}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {run.error.alternatives.map((a) => (
                  <Button
                    key={`${a.provider}:${a.model}`}
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      const next: AiSelection = { mode: "manual", provider: a.provider, model: a.model };
                      onSelection(next);
                      onRun({ sel: next });
                    }}
                  >
                    Usar {a.label} ({a.providerLabel})
                  </Button>
                ))}
                {run.error.canGenerate ? (
                  <Button size="xs" variant="secondary" onClick={() => onRun({ mode: "generate" })}>
                    Gerar imagem nova pela descrição
                  </Button>
                ) : null}
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
