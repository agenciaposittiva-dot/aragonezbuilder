"use client";

import { AlertTriangle, Bot, Save, Sparkles, X } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import {
  PROVIDER_LABEL,
  previewSelection,
  type AiPreference,
  type AiSelection,
  type PickerProvider,
} from "@/lib/ai-select";
import {
  AI_PRIORITIES,
  AI_TASKS,
  CAP_LABEL,
  compatibility,
  type AiModelInfo,
  type AiPriority,
  type AiTask,
  type ModelCaps,
} from "@/lib/ai-tasks";
import { cn } from "@/lib/utils";
import { deleteAiPreferenceAction, setAiPreferenceAction } from "@/server/actions/ai";

export type AiPickerValue = AiSelection;

const MODES: { key: AiSelection["mode"]; label: string }[] = [
  { key: "default", label: "Padrão" },
  { key: "auto", label: "Escolher automaticamente" },
  { key: "manual", label: "Escolher modelo" },
];

const CAP_KEYS: (keyof ModelCaps)[] = ["text", "imageInput", "imageOutput", "structured"];

/** Capacidades do modelo como o provedor informa ("não confirmado" quando não informa). */
export function ModelCapabilities({ model }: { model: AiModelInfo }) {
  return (
    <span className="flex flex-wrap gap-1">
      {CAP_KEYS.map((k) =>
        model.caps[k] === "no" ? null : (
          <Badge key={k} tone={model.caps[k] === "yes" ? "neutral" : "outline"}>
            {CAP_LABEL[k]}
            {model.caps[k] === "unknown" ? " (não confirmado)" : ""}
          </Badge>
        ),
      )}
      {model.deprecated ? <Badge tone="warning">descontinuado</Badge> : null}
    </span>
  );
}

/**
 * Seletor de provedor/modelo para uma tarefa. Mostra só modelos realmente
 * disponíveis (listados pela API de cada provedor) e explica a escolha
 * automática. O servidor revalida tudo antes de chamar o provedor.
 */
export function AiModelPicker({
  providers,
  preferences,
  task,
  module,
  value,
  onChange,
  disabled,
  className,
}: {
  providers: PickerProvider[];
  preferences: AiPreference[];
  task: AiTask;
  module: string;
  value: AiSelection;
  onChange: (value: AiSelection) => void;
  disabled?: boolean;
  className?: string;
}) {
  const save = useOrgAction(setAiPreferenceAction, {
    success: "Padrão salvo",
    onSuccess: () => onChange({ mode: "default" }),
  });
  const remove = useOrgAction(deleteAiPreferenceAction, { success: "Padrão removido" });
  const ready = providers.filter((p) => p.ready);
  const unavailable = providers.filter((p) => !p.ready);
  const preview = useMemo(
    () => previewSelection(providers, preferences, { module, task, selection: value }),
    [providers, preferences, module, task, value],
  );
  const taskLabel = AI_TASKS[task].label;
  const manualProvider = ready.find((p) => p.id === value.provider) ?? null;
  const models = manualProvider?.models ?? [];
  const compatible = models.filter((m) => compatibility(m, task).compatible);
  const incompatible = models.filter((m) => !compatibility(m, task).compatible);
  const hasOwnTaskDefault = preferences.some((p) => p.scope === "user" && p.task === task && p.module === "");
  const id = `ai-picker-${module}-${task}`;

  if (!ready.length) {
    return (
      <div className={cn("rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-sm", className)}>
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-warning" /> Nenhum modelo de IA disponível
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {unavailable.length
            ? `Provedores: ${unavailable.map((p) => `${p.label} — ${p.reason ?? "não validado"}`).join("; ")}.`
            : "Nenhum provedor está configurado."}{" "}
          Um administrador configura em Configurações → Inteligência artificial.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-3 rounded-lg border border-border bg-surface-2/40 p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Bot className="size-4 text-fg-subtle" /> Modelo de IA
        </span>
        <div role="radiogroup" aria-label="Como escolher o modelo" className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={value.mode === m.key}
              disabled={disabled}
              onClick={() =>
                onChange(
                  m.key === "manual"
                    ? {
                        mode: "manual",
                        provider: preview.model?.provider ?? ready[0]!.id,
                        model: preview.model && !preview.problem ? preview.model.id : null,
                        priority: value.priority,
                      }
                    : { mode: m.key, priority: value.priority },
                )
              }
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50",
                value.mode === m.key
                  ? "border-accent bg-accent-soft font-medium text-fg"
                  : "border-border bg-surface text-fg-muted hover:text-fg",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {value.mode === "auto" ? (
        <label className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" htmlFor={`${id}-priority`}>
          Prioridade
          <NativeSelect
            id={`${id}-priority`}
            className="h-8 w-auto"
            value={value.priority ?? "balanced"}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, priority: e.target.value as AiPriority })}
          >
            {Object.entries(AI_PRIORITIES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}

      {value.mode === "manual" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <NativeSelect
            aria-label="Provedor"
            value={value.provider ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, provider: e.target.value, model: null })}
          >
            {ready.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Modelo"
            value={value.model ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, model: e.target.value || null })}
          >
            <option value="">Melhor modelo compatível deste provedor</option>
            {compatible.length ? (
              <optgroup label={`Compatíveis com "${taskLabel}"`}>
                {compatible.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {compatibility(m, task).unconfirmed.length ? " (capacidade não confirmada)" : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {incompatible.length ? (
              <optgroup label="Incompatíveis com esta tarefa">
                {incompatible.map((m) => (
                  <option key={m.id} value={m.id} disabled>
                    {m.label} — {m.kind === "image" ? "só gera imagens" : "não atende à tarefa"}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </NativeSelect>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <p className={cn("flex items-start gap-1.5 text-xs", preview.problem ? "text-danger" : "text-fg-muted")}>
          {preview.problem ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>{preview.reason}</span>
        </p>
        {preview.model && !preview.problem ? <ModelCapabilities model={preview.model} /> : null}
        {preview.model && !preview.problem && preview.model.provider === "demo" ? (
          <p className="text-xs text-warning">Demonstração local: as respostas são exemplos, não IA real.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {value.mode !== "default" && !preview.problem ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            loading={save.pending}
            disabled={disabled}
            onClick={() =>
              save.run({
                scope: "user",
                module: "",
                task,
                provider: value.mode === "manual" ? (value.provider ?? null) : null,
                model: value.mode === "manual" ? (value.model ?? null) : null,
                priority: value.priority ?? "balanced",
              })
            }
          >
            <Save /> Salvar como meu padrão para “{taskLabel}”
          </Button>
        ) : null}
        {value.mode === "default" && hasOwnTaskDefault ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            loading={remove.pending}
            disabled={disabled}
            onClick={() => remove.run({ scope: "user", module: "", task })}
          >
            <X /> Remover meu padrão para “{taskLabel}”
          </Button>
        ) : null}
        {unavailable.length ? (
          <span className="text-xs text-fg-subtle">
            Indisponíveis:{" "}
            {unavailable.map((p) => `${PROVIDER_LABEL[p.id] ?? p.label} (${p.reason ?? "—"})`).join(", ")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
