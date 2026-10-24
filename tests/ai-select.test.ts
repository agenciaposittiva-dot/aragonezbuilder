import { describe, expect, it } from "vitest";
import { autoSelect, previewSelection } from "@/lib/ai-select";
import type { AiModelInfo } from "@/lib/ai-tasks";

/*
 * Escolha automática de modelo (regras puras, sem banco): a demonstração local
 * nunca vence um provedor real compatível — mesmo quando a capacidade do
 * modelo real é "não confirmada" pela listagem do provedor (caso da OpenAI em
 * tarefas estruturadas). Sozinha, a demonstração continua sendo escolhida.
 */

function model(
  provider: string,
  id: string,
  caps: Partial<AiModelInfo["caps"]>,
  extra: Partial<AiModelInfo> = {},
): AiModelInfo {
  return {
    id,
    provider,
    label: id,
    kind: "text",
    caps: { text: "yes", imageInput: "unknown", imageOutput: "no", structured: "unknown", effort: "no", ...caps },
    tier: "balanced",
    tierSource: "nome",
    maxInputTokens: null,
    maxOutputTokens: null,
    createdAt: "2026-05-01T00:00:00Z",
    deprecated: false,
    price: null,
    ...extra,
  };
}

const demo = model(
  "demo",
  "demo",
  { structured: "yes", imageInput: "no" },
  { tier: "fast", price: { input: 0, output: 0 } },
);
const openai = model("openai", "gpt-5.1", { structured: "unknown" }, { tier: "quality" });
const openaiMini = model("openai", "gpt-5.1-mini", { structured: "unknown" }, { tier: "fast" });

describe("escolha automática de modelo", () => {
  it("tarefa estruturada: provedor real (capacidade não confirmada) vence a demonstração (confirmada)", () => {
    const choice = autoSelect([demo, openai, openaiMini], "structured", "balanced");
    expect(choice?.model.provider).toBe("openai");
    // Com prioridade de custo o modelo de exemplo (preço zero) também não passa na frente.
    expect(autoSelect([demo, openai, openaiMini], "structured", "cost")?.model.provider).toBe("openai");
    expect(autoSelect([demo, openai, openaiMini], "text", "speed")?.model.id).toBe("gpt-5.1-mini");
  });

  it("só a demonstração disponível: continua sendo escolhida; incompatível com a tarefa: nada", () => {
    expect(autoSelect([demo], "structured")?.model.id).toBe("demo");
    expect(autoSelect([demo], "image_generation")).toBeNull();
  });

  it("a prévia da interface segue a mesma regra (padrão da organização sem provedor fixo)", () => {
    const providers = [
      { id: "demo", label: "Demonstração", ready: true, reason: null, models: [demo] },
      { id: "openai", label: "OpenAI", ready: true, reason: null, models: [openai] },
    ];
    const p = previewSelection(providers, [], { module: "tasks", task: "structured", selection: { mode: "default" } });
    expect(p.problem).toBe(false);
    expect(p.model?.provider).toBe("openai");
    // Escolha explícita da demonstração continua respeitada.
    const explicit = previewSelection(providers, [], {
      module: "tasks",
      task: "structured",
      selection: { mode: "manual", provider: "demo", model: "demo" },
    });
    expect(explicit.model?.id).toBe("demo");
  });
});
