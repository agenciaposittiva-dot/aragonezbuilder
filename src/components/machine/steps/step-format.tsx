"use client";

import { GalleryHorizontalEnd } from "lucide-react";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import type { AiSelection } from "@/lib/ai-select";
import { MACHINE_FORMATS, MACHINE_OBJECTIVES, type MachineObjective } from "@/lib/content-machine";
import { cn } from "@/lib/utils";
import type { StepProps } from "../machine-wizard";

/** Etapa 4: formato, objetivo, público, tom, quantidade de slides, proporção, imagens e as IAs da geração. */
export function StepFormat({ state, update, picker, can, readOnly }: StepProps) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <p className="mb-2 text-sm font-medium">Formato</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(MACHINE_FORMATS) as (keyof typeof MACHINE_FORMATS)[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={state.format === f}
              disabled={readOnly}
              onClick={() => update({ format: f })}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 text-left text-sm",
                state.format === f
                  ? "border-accent bg-accent-soft/40 ring-1 ring-accent"
                  : "border-border hover:bg-surface-2",
              )}
            >
              <GalleryHorizontalEnd className="size-5 text-accent-text" />
              <span>
                <span className="block font-medium">{MACHINE_FORMATS[f]}</span>
                <span className="block text-xs text-fg-muted">Narrativa única, slides editáveis</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-fg-subtle">
          Post estático, Stories, roteiro de Reels, legenda, anúncio e série editorial entram nas próximas etapas da
          Máquina.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Objetivo" htmlFor="machine-objective">
          <NativeSelect
            id="machine-objective"
            value={state.objective}
            disabled={readOnly}
            onChange={(e) => update({ objective: e.target.value as MachineObjective })}
          >
            {Object.entries(MACHINE_OBJECTIVES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Quantidade de slides"
          htmlFor="machine-slides"
          hint="Automático: a IA sugere pelo assunto (5 a 8)."
        >
          <NativeSelect
            id="machine-slides"
            value={state.slides ?? ""}
            disabled={readOnly}
            onChange={(e) => update({ slides: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Automático</option>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n} slides
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Público (opcional)" htmlFor="machine-audience" hint="Vazio: usa o público do ângulo e da marca.">
          <Input
            id="machine-audience"
            value={state.audience}
            maxLength={500}
            readOnly={readOnly}
            onChange={(e) => update({ audience: e.target.value })}
          />
        </Field>
        <Field label="Tom (opcional)" htmlFor="machine-tone" hint="Vazio: usa o tom de voz da marca.">
          <Input
            id="machine-tone"
            value={state.tone}
            maxLength={160}
            readOnly={readOnly}
            onChange={(e) => update({ tone: e.target.value })}
          />
        </Field>
        <Field label="Proporção" htmlFor="machine-aspect">
          <NativeSelect
            id="machine-aspect"
            value={state.aspect}
            disabled={readOnly}
            onChange={(e) => update({ aspect: e.target.value as "portrait" | "square" })}
          >
            <option value="portrait">Retrato 4:5 (1080 × 1350)</option>
            <option value="square">Quadrado (1080 × 1080)</option>
          </NativeSelect>
        </Field>
        <Field
          label="Imagens"
          htmlFor="machine-images"
          hint="Imagens geradas ficam em Arquivos e podem ser trocadas no editor."
        >
          <NativeSelect
            id="machine-images"
            value={state.images === "none" ? "none" : String(state.maxImages)}
            disabled={readOnly}
            onChange={(e) =>
              e.target.value === "none"
                ? update({ images: "none" })
                : update({ images: "auto", maxImages: Number(e.target.value) })
            }
          >
            <option value="none">Sem imagens de IA (formas, ícones e tipografia)</option>
            <option value="1">Até 1 imagem de IA</option>
            <option value="2">Até 2 imagens de IA</option>
            <option value="4">Até 4 imagens de IA</option>
          </NativeSelect>
        </Field>
      </div>

      {can.ai && picker ? (
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">IA do roteiro</p>
            <AiModelPicker
              providers={picker.providers}
              preferences={picker.preferences}
              task="planning"
              module="carousel"
              value={(state.ai.copy ?? { mode: "default" }) as AiSelection}
              onChange={(v) => update((s) => ({ ...s, ai: { ...s.ai, copy: v as Record<string, unknown> } }))}
              disabled={readOnly}
            />
          </div>
          {state.images === "auto" ? (
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">IA das imagens</p>
              <AiModelPicker
                providers={picker.providers}
                preferences={picker.preferences}
                task="image_generation"
                module="carousel"
                value={(state.ai.image ?? { mode: "default" }) as AiSelection}
                onChange={(v) => update((s) => ({ ...s, ai: { ...s.ai, image: v as Record<string, unknown> } }))}
                disabled={readOnly}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
