"use client";

import { AlertTriangle, Check, Circle, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ANGLE_TYPES, chosenAngle, MACHINE_FORMATS, MACHINE_OBJECTIVES, SOURCE_KINDS } from "@/lib/content-machine";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StepProps } from "../machine-wizard";
import { CostPrompt } from "./cost-prompt";

const STEPS = [
  { key: "plan", label: "Planejando a narrativa" },
  { key: "script", label: "Escrevendo os slides" },
  { key: "visuals", label: "Preparando recursos visuais" },
  { key: "assemble", label: "Montando a identidade visual" },
  { key: "save", label: "Salvando no Estúdio e em Conteúdos" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
type StepState = { status: "pending" | "running" | "done" | "skipped"; detail?: string };
type Meta = { demo: boolean; providerLabel: string; modelLabel: string; warnings: string[] };

const empty = () => Object.fromEntries(STEPS.map((s) => [s.key, { status: "pending" }])) as Record<StepKey, StepState>;

/**
 * Etapa 5: gera o carrossel com o gerador existente (roteiro narrativo, regra de
 * números, identidade da marca, imagens em Arquivos) e liga a arte à peça de
 * conteúdo. O progresso mostrado é o real, etapa por etapa.
 */
export function StepGenerate({ view, state, can, readOnly, flush }: StepProps & { flush: () => Promise<void> }) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [steps, setSteps] = useState<Record<StepKey, StepState> | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(view.project.status === "draft" ? view.project.lastError : null);
  const [cost, setCost] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const angle = chosenAngle(state);
  const allowed = can.ai && can.designs && !readOnly;

  async function generate(confirmCost = false) {
    setError(null);
    setCost(null);
    setMeta(null);
    setSteps(empty());
    setRunning(true);
    await flush();
    const controller = new AbortController();
    abort.current = controller;
    let finished = false;
    try {
      const res = await fetch("/api/maquina/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ orgSlug, id: view.project.id, confirmCost }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        setSteps(null);
        if (err.code === "cost_confirmation") setCost(err.error ?? "Confirme o custo para continuar.");
        else setError(err.error ?? "Não foi possível gerar o conteúdo.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as
            | ({ t: "meta" } & Meta)
            | { t: "step"; step: StepKey; status: StepState["status"]; detail?: string }
            | { t: "done"; claims: unknown[]; notice: string | null }
            | { t: "machine"; designId: string; contentItemId: string }
            | { t: "error"; message: string };
          if (msg.t === "meta") setMeta(msg);
          else if (msg.t === "step")
            setSteps((s) => ({ ...(s ?? empty()), [msg.step]: { status: msg.status, detail: msg.detail } }));
          else if (msg.t === "error") {
            finished = true;
            setError(msg.message);
          } else if (msg.t === "done") {
            if (msg.notice) toast.warning(msg.notice);
          } else if (msg.t === "machine") {
            finished = true;
            toast.success("Conteúdo gerado: arte no Estúdio e peça em Conteúdos.");
            router.refresh();
          }
        }
      }
      if (!finished && !controller.signal.aborted)
        setError("A conexão terminou antes do fim. Nada foi marcado como pronto; tente de novo.");
    } catch {
      if (!controller.signal.aborted) setError("Falha de conexão durante a geração. Tente de novo.");
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <dl className="grid gap-3 rounded-lg border border-border bg-surface-2/30 p-4 text-sm sm:grid-cols-2">
        <Item label="Marca" value={view.brand.client.name} />
        <Item
          label="Assunto"
          value={`${state.source?.title || "—"}${state.source ? ` (${SOURCE_KINDS[state.source.kind].toLowerCase()})` : ""}`}
        />
        <Item label="Ângulo" value={angle ? `${ANGLE_TYPES[angle.type]}: ${angle.hook}` : "—"} />
        <Item
          label="Formato"
          value={`${MACHINE_FORMATS[state.format]} · ${state.slides ? `${state.slides} slides` : "quantidade automática"} · ${state.aspect === "square" ? "quadrado" : "retrato 4:5"}`}
        />
        <Item label="Objetivo" value={MACHINE_OBJECTIVES[state.objective]} />
        <Item
          label="Imagens"
          value={state.images === "none" ? "Sem imagens de IA" : `Até ${state.maxImages} imagem(ns) de IA`}
        />
      </dl>

      {view.design ? (
        <p className="rounded-lg border border-border px-4 py-3 text-sm text-fg-muted">
          Conteúdo já gerado
          {state.generation ? ` em ${formatDateTime(state.generation.at)}` : ""}. Gerar de novo cria uma arte nova e
          atualiza a peça; a arte atual continua no Estúdio, com o histórico de versões.
        </p>
      ) : null}

      {cost ? <CostPrompt message={cost} onConfirm={() => void generate(true)} onCancel={() => setCost(null)} /> : null}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          data-testid="machine-generate"
          loading={running}
          disabled={!allowed || !angle || running}
          onClick={() => void generate()}
        >
          {view.design ? <RefreshCw /> : <Sparkles />} {view.design ? "Gerar de novo" : "Gerar carrossel"}
        </Button>
        {running ? (
          <Button variant="secondary" onClick={() => abort.current?.abort()}>
            <X /> Cancelar
          </Button>
        ) : null}
        {!allowed ? (
          <p className="text-xs text-fg-muted">Gerar exige acesso à IA e permissão para criar artes.</p>
        ) : null}
      </div>

      {steps ? (
        <div className="grid gap-3 rounded-lg border border-border p-4" aria-live="polite">
          {meta ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span>
                {meta.providerLabel} · {meta.modelLabel}
              </span>
              {meta.demo ? <Badge tone="info">Demonstração</Badge> : null}
            </div>
          ) : null}
          <ol className="grid grid-cols-1 gap-2">
            {STEPS.map((s) => {
              const st = steps[s.key];
              return (
                <li key={s.key} className="flex items-start gap-2 text-sm" data-status={st.status}>
                  <span className="mt-0.5">
                    {st.status === "done" ? (
                      <Check className="size-4 text-success" />
                    ) : st.status === "running" ? (
                      <Loader2 className="size-4 animate-spin text-accent-text" />
                    ) : (
                      <Circle
                        className={cn("size-4", st.status === "skipped" ? "text-fg-subtle" : "text-border-strong")}
                      />
                    )}
                  </span>
                  <span className={cn(st.status === "pending" && "text-fg-muted")}>
                    {s.label}
                    {st.detail ? <span className="block text-xs text-fg-muted">{st.detail}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {meta?.warnings.length ? (
            <ul className="list-disc pl-5 text-xs text-fg-muted">
              {meta.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
