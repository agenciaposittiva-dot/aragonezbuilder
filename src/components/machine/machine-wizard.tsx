"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Check, Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiPreference, PickerProvider } from "@/lib/ai-select";
import { MACHINE_STEPS, reachableStep, type MachineState } from "@/lib/content-machine";
import { cn } from "@/lib/utils";
import { saveMachineProjectAction } from "@/server/actions/content-machine";
import type { ActionResult } from "@/server/actions/safe-action";
import type { MachineProjectView } from "@/server/services/content-machine";
import { StepAngle } from "./steps/step-angle";
import { StepClient } from "./steps/step-client";
import { StepDeliver } from "./steps/step-deliver";
import { StepFormat } from "./steps/step-format";
import { StepGenerate } from "./steps/step-generate";
import { StepPreview, StepReview, StepVisual } from "./steps/step-result";
import { StepTopic } from "./steps/step-topic";

export type MachineCan = {
  write: boolean;
  ai: boolean;
  trends: boolean;
  files: boolean;
  designs: boolean;
  tasks: boolean;
  approvals: boolean;
};

export type TrendOption = {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  lastSeenAt: string;
  sourceName: string;
  platform: string;
  observations: number;
};

export type Picker = { providers: PickerProvider[]; preferences: AiPreference[] } | null;

/** O que cada etapa recebe: estado, ações e permissões. */
export type StepProps = {
  view: MachineProjectView;
  state: MachineState;
  update: (patch: Partial<MachineState> | ((s: MachineState) => MachineState)) => void;
  /**
   * Chama uma ação do servidor que grava o projeto (salva o pendente antes e
   * atualiza a revisão depois). `onCost`: a IA pede confirmação de custo.
   */
  server: <T extends { revision: number }>(
    call: () => Promise<ActionResult<T>>,
    opts?: { onCost?: (message: string) => void },
  ) => Promise<T | null>;
  go: (step: number) => void;
  can: MachineCan;
  picker: Picker;
  clientId: string;
  setClientId: (id: string) => void;
  clients: { id: string; name: string }[];
  trends: TrendOption[];
  readOnly: boolean;
};

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

/** A IA pediu confirmação de custo (mesmo critério das outras telas de IA). */
export const isCostPrompt = (r: ActionResult<unknown>) =>
  !r.ok && r.code === "conflict" && /Confirme para continuar/.test(r.error ?? "");

/**
 * Assistente da Máquina de Conteúdo: 9 etapas com progresso visível, voltar a
 * qualquer etapa já liberada e salvamento automático com controle de revisão
 * (outra aba não sobrescreve sem aviso). As etapas só avançam quando as
 * decisões anteriores existem.
 */
export function MachineWizard({
  view,
  clients,
  trends,
  picker,
  can,
}: {
  view: MachineProjectView;
  clients: { id: string; name: string }[];
  trends: TrendOption[];
  picker: Picker;
  can: MachineCan;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const readOnly = !can.write || view.project.archived;
  const [title, setTitle] = useState(view.project.title);
  const [clientId, setClientId] = useState(view.project.clientId);
  const [state, setState] = useState<MachineState>(view.state);
  const [step, setStep] = useState(Math.min(view.project.step, view.reachable));
  const [save, setSave] = useState<SaveState>("saved");
  const revision = useRef(view.project.revision);
  const latest = useRef({ title, clientId, state, step });
  const inFlight = useRef<Promise<void> | null>(null);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const hasResult = !!view.design;
  const reachable = reachableStep(state, hasResult);

  const persist = useCallback(async (): Promise<void> => {
    if (readOnly) return;
    if (inFlight.current) {
      pending.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      do {
        pending.current = false;
        const snap = latest.current;
        setSave("saving");
        let res: ActionResult<{ revision: number; step: number; state: MachineState; clientId: string }>;
        try {
          res = await saveMachineProjectAction(orgSlug, {
            id: view.project.id,
            revision: revision.current,
            title: snap.title.trim() || "Novo conteúdo",
            step: snap.step,
            clientId: snap.clientId,
            state: snap.state,
          });
        } catch {
          res = { ok: false, error: "Falha de conexão." };
        }
        if (!res.ok) {
          setSave(res.code === "conflict" ? "conflict" : "error");
          return;
        }
        revision.current = res.data.revision;
        // Trocar de cliente descarta o que era da marca anterior: o servidor devolve o estado limpo.
        if (snap.clientId !== view.project.clientId && res.data.state.angles.length !== snap.state.angles.length) {
          setState(res.data.state);
        }
      } while (pending.current);
      setSave("saved");
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  }, [orgSlug, readOnly, view.project.id, view.project.clientId]);

  // Salvamento automático (com pausa curta enquanto a pessoa digita). O "pendente" é marcado por quem altera.
  useEffect(() => {
    latest.current = { title, clientId, state, step };
    if (first.current) {
      first.current = false;
      return;
    }
    if (readOnly || save === "conflict") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, clientId, state, step]);

  const markDirty = useCallback(() => {
    if (!readOnly) setSave((v) => (v === "conflict" ? v : "dirty"));
  }, [readOnly]);

  // Sai da página com alteração pendente: avisa o navegador.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (save === "dirty" || save === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [save]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (save === "dirty" || inFlight.current) await persist();
  }, [persist, save]);

  const server = useCallback(
    async <T extends { revision: number }>(
      call: () => Promise<ActionResult<T>>,
      opts?: { onCost?: (message: string) => void },
    ): Promise<T | null> => {
      await flush();
      const res: ActionResult<T> = await call().catch(() => ({ ok: false as const, error: "Falha de conexão." }));
      if (!res.ok && opts?.onCost && isCostPrompt(res)) {
        opts.onCost(res.error);
        return null;
      }
      if (!res.ok) {
        const { toast } = await import("sonner");
        toast.error(res.error);
        return null;
      }
      revision.current = res.data.revision;
      return res.data;
    },
    [flush],
  );

  const update: StepProps["update"] = useCallback(
    (patch) => {
      markDirty();
      setState((s) => (typeof patch === "function" ? patch(s) : { ...s, ...patch }));
    },
    [markDirty],
  );

  const go = useCallback(
    (n: number) => {
      markDirty();
      setStep(Math.max(1, Math.min(n, 9)));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [markDirty],
  );
  const changeClient = useCallback(
    (id: string) => {
      markDirty();
      setClientId(id);
    },
    [markDirty],
  );

  const props: StepProps = {
    view,
    state,
    update,
    server,
    go,
    can,
    picker,
    clientId,
    setClientId: changeClient,
    clients,
    trends,
    readOnly,
  };
  const canNext = step < 9 && step + 1 <= reachable && step !== 5;
  const current = MACHINE_STEPS[step - 1]!;

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            href={`/w/${orgSlug}/maquina`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3" /> Máquina de Conteúdo
          </Link>
          <Input
            aria-label="Nome do projeto"
            value={title}
            maxLength={160}
            readOnly={readOnly}
            onChange={(e) => {
              markDirty();
              setTitle(e.target.value);
            }}
            className="h-auto border-transparent bg-transparent px-0 text-xl font-semibold tracking-tight shadow-none hover:border-border focus-visible:border-border sm:text-2xl"
          />
          <p className="mt-0.5 text-sm text-fg-muted">
            {clients.find((c) => c.id === clientId)?.name ?? view.brand.client.name}
            {view.project.archived ? " · arquivado" : ""}
          </p>
        </div>
        <SaveIndicator state={save} onReload={() => router.refresh()} readOnly={readOnly} />
      </div>

      {save === "conflict" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm"
        >
          <AlertTriangle className="size-4 text-warning" />
          <span className="min-w-0 flex-1">
            Este projeto foi alterado em outra aba ou por outra pessoa. Suas últimas mudanças não foram salvas.
          </span>
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            <RefreshCw /> Recarregar
          </Button>
        </div>
      ) : null}

      <Stepper step={step} reachable={reachable} onSelect={go} />

      <section
        aria-labelledby="machine-step-title"
        data-testid={`machine-step-${step}`}
        className="rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-6"
      >
        <div className="mb-5 flex items-center gap-2">
          <Badge tone="accent">
            Etapa {step} de {MACHINE_STEPS.length}
          </Badge>
          <h2 id="machine-step-title" className="text-base font-semibold">
            {current.label}
          </h2>
        </div>
        {step === 1 ? <StepClient {...props} /> : null}
        {step === 2 ? <StepTopic {...props} /> : null}
        {step === 3 ? <StepAngle {...props} /> : null}
        {step === 4 ? <StepFormat {...props} /> : null}
        {step === 5 ? <StepGenerate {...props} flush={flush} /> : null}
        {step === 6 ? <StepVisual {...props} /> : null}
        {step === 7 ? <StepReview {...props} /> : null}
        {step === 8 ? <StepPreview {...props} /> : null}
        {step === 9 ? <StepDeliver {...props} /> : null}
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" disabled={step === 1} onClick={() => go(step - 1)}>
          <ArrowLeft /> Voltar
        </Button>
        {step < 9 ? (
          <Button
            variant="primary"
            data-testid="machine-continue"
            disabled={!canNext && !(step === 5 && hasResult)}
            onClick={() => go(step + 1)}
          >
            Continuar <ArrowRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SaveIndicator({ state, onReload, readOnly }: { state: SaveState; onReload: () => void; readOnly: boolean }) {
  if (readOnly) return <Badge tone="outline">Somente leitura</Badge>;
  const map = {
    saved: { icon: <Cloud className="size-3.5" />, label: "Salvo", tone: "text-fg-muted" },
    dirty: { icon: <Cloud className="size-3.5" />, label: "Alterações pendentes", tone: "text-fg-muted" },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, label: "Salvando…", tone: "text-fg-muted" },
    conflict: { icon: <CloudOff className="size-3.5" />, label: "Não salvo", tone: "text-warning" },
    error: { icon: <CloudOff className="size-3.5" />, label: "Falha ao salvar", tone: "text-danger" },
  }[state];
  return (
    <p
      className={cn("flex shrink-0 items-center gap-1.5 text-xs", map.tone)}
      aria-live="polite"
      data-testid="machine-save-state"
      data-state={state}
    >
      {map.icon} {map.label}
      {state === "error" ? (
        <button type="button" onClick={onReload} className="underline">
          tentar de novo
        </button>
      ) : null}
    </p>
  );
}

function Stepper({ step, reachable, onSelect }: { step: number; reachable: number; onSelect: (n: number) => void }) {
  return (
    <nav aria-label="Etapas da Máquina">
      {/* Celular: etapa atual e barra de progresso. */}
      <div className="sm:hidden">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={9}
          aria-valuenow={step}
          aria-label="Progresso"
        >
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(step / 9) * 100}%` }} />
        </div>
      </div>
      <ol className="flex gap-1.5 overflow-x-auto pb-1 max-sm:mt-3 max-sm:scrollbar-thin sm:grid sm:grid-cols-9 sm:overflow-visible">
        {MACHINE_STEPS.map((s) => {
          const done = s.n < step && s.n <= reachable;
          const enabled = s.n <= reachable;
          const active = s.n === step;
          return (
            <li key={s.key} className="shrink-0 sm:min-w-0">
              <button
                type="button"
                disabled={!enabled}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(s.n)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-accent-soft-fg"
                    : enabled
                      ? "border-border bg-surface hover:bg-surface-2"
                      : "cursor-not-allowed border-border/60 bg-surface-2/40 text-fg-subtle",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    active ? "bg-accent text-accent-fg" : done ? "bg-success text-white" : "bg-surface-2 text-fg-muted",
                  )}
                >
                  {done ? <Check className="size-3" /> : s.n}
                </span>
                <span className="truncate font-medium">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
