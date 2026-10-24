"use client";

import { CheckCircle2, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { AiSelection } from "@/lib/ai-select";
import { ANGLE_TYPES, type Angle } from "@/lib/content-machine";
import { cn } from "@/lib/utils";
import { machineAnglesAction } from "@/server/actions/content-machine";
import type { StepProps } from "../machine-wizard";
import { CostPrompt } from "./cost-prompt";

/** Etapa 3: abordagens originais para o assunto; escolher uma (e ajustar) ou pedir outras. */
export function StepAngle({ view, state, update, server, can, picker, readOnly }: StepProps) {
  const { orgSlug } = useWorkspace();
  const [busy, setBusy] = useState<"fresh" | "more" | null>(null);
  const [cost, setCost] = useState<{ message: string; more: boolean } | null>(null);

  const generate = async (more: boolean, confirmCost = false) => {
    setBusy(more ? "more" : "fresh");
    setCost(null);
    const res = await server(
      () =>
        machineAnglesAction(orgSlug, {
          id: view.project.id,
          more,
          selection: (state.ai.strategy ?? undefined) as AiSelection | undefined,
          confirmCost,
        }),
      { onCost: (message) => setCost({ message, more }) },
    );
    if (res) {
      update({ angles: res.angles, angleId: res.angleId });
      if (res.notice) toast.info(res.notice);
    }
    setBusy(null);
  };

  const edit = (id: string, patch: Partial<Angle>) =>
    update((s) => ({ ...s, angles: s.angles.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-2xl text-sm text-fg-muted">
          Cada ângulo é um jeito diferente de contar o assunto: gancho, ideia central, público, objetivo, diferencial,
          CTA e as fontes que precisam ser conferidas. Escolha um e ajuste se quiser.
        </p>
        {can.ai && picker ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <AiModelPicker
              providers={picker.providers}
              preferences={picker.preferences}
              task="planning"
              module="machine"
              value={(state.ai.strategy ?? { mode: "default" }) as AiSelection}
              onChange={(v) => update((s) => ({ ...s, ai: { ...s.ai, strategy: v as Record<string, unknown> } }))}
              disabled={readOnly}
            />
            {state.angles.length ? (
              <Button
                variant="secondary"
                loading={busy === "more"}
                disabled={readOnly || !!busy}
                onClick={() => void generate(true)}
              >
                <Plus /> Novas alternativas
              </Button>
            ) : null}
            <Button
              variant={state.angles.length ? "secondary" : "primary"}
              loading={busy === "fresh"}
              disabled={readOnly || !!busy}
              onClick={() => void generate(false)}
              data-testid="machine-angles"
            >
              <Sparkles /> {state.angles.length ? "Gerar de novo" : "Gerar ângulos"}
            </Button>
          </div>
        ) : null}
      </div>
      {cost ? (
        <CostPrompt
          message={cost.message}
          onConfirm={() => void generate(cost.more, true)}
          onCancel={() => setCost(null)}
        />
      ) : null}

      {state.angles.length ? (
        <ul role="radiogroup" aria-label="Ângulos" className="grid gap-3 lg:grid-cols-2">
          {state.angles.map((a) => {
            const selected = state.angleId === a.id;
            return (
              <li key={a.id} className="min-w-0">
                <div
                  data-testid="machine-angle"
                  className={cn(
                    "flex h-full flex-col gap-2 rounded-lg border p-4 text-sm transition-colors",
                    selected ? "border-accent bg-accent-soft/30 ring-1 ring-accent" : "border-border",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Badge tone="neutral">{ANGLE_TYPES[a.type]}</Badge>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`Escolher: ${a.hook}`}
                      disabled={readOnly}
                      onClick={() => update({ angleId: selected ? null : a.id })}
                      className={cn(
                        "ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
                        selected ? "bg-accent text-accent-fg" : "border border-border hover:bg-surface-2",
                      )}
                    >
                      {selected ? <CheckCircle2 className="size-3.5" /> : null}
                      {selected ? "Escolhido" : "Escolher"}
                    </button>
                  </div>
                  {selected && !readOnly ? (
                    <div className="grid grid-cols-1 gap-2">
                      <Field label="Gancho" htmlFor={`hook-${a.id}`}>
                        <Input
                          id={`hook-${a.id}`}
                          value={a.hook}
                          maxLength={240}
                          onChange={(e) => edit(a.id, { hook: e.target.value })}
                        />
                      </Field>
                      <Field label="Ideia central" htmlFor={`idea-${a.id}`}>
                        <Textarea
                          id={`idea-${a.id}`}
                          rows={3}
                          value={a.idea}
                          maxLength={600}
                          onChange={(e) => edit(a.id, { idea: e.target.value })}
                        />
                      </Field>
                      <Field label="CTA" htmlFor={`cta-${a.id}`}>
                        <Input
                          id={`cta-${a.id}`}
                          value={a.cta}
                          maxLength={200}
                          onChange={(e) => edit(a.id, { cta: e.target.value })}
                        />
                      </Field>
                    </div>
                  ) : (
                    <>
                      <p className="text-base leading-snug font-semibold">{a.hook}</p>
                      <p className="text-fg-muted">{a.idea}</p>
                    </>
                  )}
                  <dl className="mt-1 grid gap-1 text-xs text-fg-muted">
                    {a.audience ? <Row label="Público" value={a.audience} /> : null}
                    {a.objective ? <Row label="Objetivo" value={a.objective} /> : null}
                    {a.differential ? <Row label="Diferencial" value={a.differential} /> : null}
                    {!selected && a.cta ? <Row label="CTA" value={a.cta} /> : null}
                    {a.sourcesNeeded.length ? (
                      <Row label="Confirmar com fonte" value={a.sourcesNeeded.join("; ")} />
                    ) : null}
                  </dl>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-fg-muted">
          {can.ai
            ? "Gere os ângulos para escolher a abordagem do conteúdo."
            : "Peça a alguém com acesso à IA para gerar os ângulos."}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-medium text-fg">{label}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}
