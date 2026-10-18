import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { autoSelect, pickPreference, type AiPreference } from "@/lib/ai-select";
import type { AiModelInfo } from "@/lib/ai-tasks";
import { classifyGeminiModel, classifyOpenAiModel } from "@/server/ai/registry";
import type { Actor } from "@/server/authz";
import { withOrg } from "@/server/db";
import { aiGenerations, aiProviderConfigs, aiUsage, fileVersions } from "@/server/db/schema";
import { env } from "@/server/env";
import {
  aiUsageReport,
  assertCanGenerate,
  CostConfirmationError,
  getAiSettingsView,
  prepareGeneration,
  recordUsage,
  updateAiSettings,
} from "@/server/services/ai";
import { prepareImage } from "@/server/services/ai-images";
import {
  getPickerData,
  listPreferences,
  ModelSelectionError,
  resolveSelection,
  setPreference,
} from "@/server/services/ai-models";
import { providerStates, saveProviderKey, setProviderEnabled, validateProvider } from "@/server/services/ai-providers";
import { runGeneration, runImage, type GenerationEvent } from "@/server/services/ai-run";
import { createClient } from "@/server/services/clients";
import { createProject } from "@/server/services/projects";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

const KEYS = {
  anthropic: "sk-ant-teste-valida-a111",
  openai: "sk-openai-teste-valida-b222",
  gemini: "gemini-teste-valida-c333",
};
const policy = { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };

let mock: ReturnType<typeof installAiMock>;
const savedEnv = {
  demo: env.AI_DEFAULT_PROVIDER,
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  gemini: env.GEMINI_API_KEY,
};

beforeAll(async () => {
  env.AI_DEFAULT_PROVIDER = "anthropic";
  env.ANTHROPIC_API_KEY = undefined;
  env.OPENAI_API_KEY = undefined;
  env.GEMINI_API_KEY = undefined;
  mock = installAiMock();
  for (const [p, k] of Object.entries(KEYS)) mock.state.valid[p as keyof typeof KEYS].add(k);
  await resetDb();
});

afterAll(() => {
  env.AI_DEFAULT_PROVIDER = savedEnv.demo;
  env.ANTHROPIC_API_KEY = savedEnv.anthropic;
  env.OPENAI_API_KEY = savedEnv.openai;
  env.GEMINI_API_KEY = savedEnv.gemini;
  vi.unstubAllGlobals();
});

beforeEach(() => mock.reset());

async function orgWith(name: string, providers: (keyof typeof KEYS)[]) {
  const ctx = await createOrgWithOwner(name);
  for (const p of providers) {
    const r = await as(ctx.actor, (s) => saveProviderKey(s, p, KEYS[p]));
    expect(r.ok).toBe(true);
  }
  return ctx;
}

async function collect(
  actor: Actor,
  prepared: Awaited<ReturnType<typeof prepareGeneration>>,
  input: Record<string, string>,
) {
  const events: GenerationEvent[] = [];
  const result = await runGeneration(actor, prepared, input, { send: (e) => events.push(e) });
  return { events, result };
}

/* ------------------------------------------------------------------ */

describe("descoberta de modelos", () => {
  it("classifica modelos da OpenAI sem inventar capacidades", () => {
    expect(classifyOpenAiModel("gpt-image-1")?.kind).toBe("image");
    expect(classifyOpenAiModel("gpt-image-1")?.caps.imageOutput).toBe("yes");
    const text = classifyOpenAiModel("gpt-5.1")!;
    expect(text.kind).toBe("text");
    expect(text.caps.imageInput).toBe("unknown");
    expect(text.caps.structured).toBe("unknown");
    expect(classifyOpenAiModel("text-embedding-3-small")).toBeNull();
    expect(classifyOpenAiModel("whisper-1")).toBeNull();
  });

  it("aceita só modelos do Gemini que geram conteúdo", () => {
    expect(
      classifyGeminiModel({ name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] })?.id,
    ).toBe("gemini-3.5-flash");
    expect(
      classifyGeminiModel({ name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }),
    ).toBeNull();
  });

  it("lista só os modelos devolvidos pela API de cada provedor habilitado", async () => {
    const ctx = await orgWith("Descoberta", ["anthropic", "openai", "gemini"]);
    const data = await as(ctx.actor, (s) => getPickerData(s));
    const ids = data.providers.flatMap((p) => p.models.map((m) => `${p.id}:${m.id}`)).sort();
    expect(ids).toEqual(
      [
        "anthropic:claude-haiku-5-5",
        "anthropic:claude-sonnet-5-5",
        "gemini:gemini-3.5-flash",
        "openai:gpt-5.1",
        "openai:gpt-5.1-mini",
        "openai:gpt-image-1",
      ].sort(),
    );
    // A demonstração fica desligada por padrão.
    expect(data.providers.find((p) => p.id === "demo")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe("credenciais", () => {
  it("chave recusada pelo provedor não é salva nem substitui a atual", async () => {
    const ctx = await orgWith("Credenciais", ["openai"]);
    const r = await as(ctx.actor, (s) => saveProviderKey(s, "openai", "sk-openai-invalida-9999"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inválida/i);
    const [state] = (await as(ctx.actor, (s) => providerStates(s, { admin: true }))).filter((p) => p.id === "openai");
    expect(state?.keyMask).toBe("••••b222");
    expect(state?.enabled).toBe(true);
    expect(state?.ready).toBe(true);
  });

  it("não habilita provedor sem credencial válida", async () => {
    const ctx = await orgWith("Sem credencial", []);
    await expect(as(ctx.actor, (s) => setProviderEnabled(s, "gemini", true))).rejects.toThrow(
      /Não foi possível habilitar/,
    );
    const rows = await withOrg(ctx.org.id, (tx) => tx.select().from(aiProviderConfigs));
    expect(rows.find((r) => r.provider === "gemini")?.enabled ?? false).toBe(false);
  });

  it("valida no primeiro uso uma chave ainda não verificada e guarda a lista de modelos", async () => {
    const ctx = await orgWith("Primeiro uso", []);
    // Caminho antigo das configurações: a chave entra como "não verificada".
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, provider: "openai", model: "", apiKey: KEYS.openai }));
    expect(mock.calls).toHaveLength(0);
    const r = await as(ctx.actor, (s) => resolveSelection(s, { module: "assistant", task: "captions" }));
    expect(r.def.id).toBe("openai");
    expect(mock.calls.filter((c) => c.url === "https://api.openai.com/v1/models")).toHaveLength(1);
    await as(ctx.actor, (s) => resolveSelection(s, { module: "assistant", task: "captions" }));
    expect(mock.calls.filter((c) => c.url === "https://api.openai.com/v1/models")).toHaveLength(1);
  });

  it("nunca expõe chaves nas respostas de visualização", async () => {
    const ctx = await orgWith("Segredos", ["anthropic", "openai"]);
    await as(ctx.actor, (s) => validateProvider(s, "anthropic"));
    const views = await as(ctx.actor, async (s) => ({
      settings: await getAiSettingsView(s),
      admin: await providerStates(s, { admin: true }),
      member: await providerStates(s),
      picker: await getPickerData(s),
      report: await aiUsageReport(s),
      prefs: await listPreferences(s),
    }));
    const text = JSON.stringify(views);
    for (const k of Object.values(KEYS)) expect(text).not.toContain(k);
    expect(views.member.every((p) => p.keyMask === null)).toBe(true);
    const encrypted = await withOrg(ctx.org.id, (tx) => tx.select().from(aiProviderConfigs));
    for (const row of encrypted) if (row.keyEncrypted) expect(text).not.toContain(row.keyEncrypted);
  });
});

/* ------------------------------------------------------------------ */

describe("escolha de provedor e modelo", () => {
  let ctx: Awaited<ReturnType<typeof orgWith>>;
  const pick = (
    selection?: Parameters<typeof resolveSelection>[1]["selection"],
    task: "captions" | "summary" = "captions",
    module = "assistant",
  ) => as(ctx.actor, (s) => resolveSelection(s, { module, task, selection }));

  beforeAll(async () => {
    ctx = await orgWith("Escolha", ["anthropic", "openai"]);
  });

  it("escolha automática explica o motivo e prefere capacidades confirmadas", async () => {
    const r = await as(ctx.actor, (s) => resolveSelection(s, { module: "tasks", task: "structured" }));
    // A Anthropic confirma saída estruturada; a listagem da OpenAI não informa.
    expect(r.def.id).toBe("anthropic");
    expect(r.source).toBe("auto");
    expect(r.reason).toMatch(/^Escolha automática/);
    const fast = await pick({ mode: "auto", priority: "speed" });
    expect(fast.model.tier).toBe("fast");
  });

  it("aplica a precedência: explícita > pessoa (tarefa, módulo, geral) > organização (tarefa, módulo, geral) > automático", async () => {
    expect((await pick()).source).toBe("auto");

    const steps: [Parameters<typeof setPreference>[1], string, string][] = [
      [{ scope: "org", provider: "openai", model: "gpt-5.1" }, "org", "gpt-5.1"],
      [
        { scope: "org", module: "assistant", provider: "anthropic", model: "claude-haiku-5-5" },
        "org_module",
        "claude-haiku-5-5",
      ],
      [{ scope: "org", task: "captions", provider: "openai", model: "gpt-5.1-mini" }, "org_task", "gpt-5.1-mini"],
      [{ scope: "user", provider: "anthropic", model: "claude-sonnet-5-5" }, "user", "claude-sonnet-5-5"],
      [{ scope: "user", module: "assistant", provider: "openai", model: "gpt-5.1" }, "user_module", "gpt-5.1"],
      [
        { scope: "user", task: "captions", provider: "anthropic", model: "claude-haiku-5-5" },
        "user_task",
        "claude-haiku-5-5",
      ],
    ];
    for (const [pref, level, model] of steps) {
      await as(ctx.actor, (s) => setPreference(s, pref));
      const r = await pick();
      expect([r.source, r.model.id]).toEqual([level, model]);
    }
    const explicit = await pick({ mode: "manual", provider: "openai", model: "gpt-5.1-mini" });
    expect([explicit.source, explicit.model.id]).toEqual(["explicit", "gpt-5.1-mini"]);

    // Em outro módulo e tarefa vale o padrão geral da pessoa.
    const other = await pick(undefined, "summary", "reports");
    expect([other.source, other.model.id]).toEqual(["user", "claude-sonnet-5-5"]);

    // Os padrões de outra pessoa não afetam esta.
    const colleague = await addMember(ctx.org.slug, ctx.org.id, "manager");
    const r = await as(colleague, (s) => resolveSelection(s, { module: "assistant", task: "captions" }));
    expect([r.source, r.model.id]).toEqual(["org_task", "gpt-5.1-mini"]);
  });

  it("salvar de novo atualiza o padrão do mesmo nível", async () => {
    await as(ctx.actor, (s) =>
      setPreference(s, { scope: "user", task: "captions", provider: "openai", model: "gpt-5.1" }),
    );
    const prefs = (await as(ctx.actor, listPreferences)).filter((p) => p.scope === "user" && p.task === "captions");
    expect(prefs).toHaveLength(1);
    expect(prefs[0]?.model).toBe("gpt-5.1");
  });

  it("modelo incompatível com a tarefa gera erro claro com alternativas (sem troca silenciosa)", async () => {
    const err = await pick({ mode: "manual", provider: "openai", model: "gpt-image-1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelSelectionError);
    const e = err as ModelSelectionError;
    expect(e.reason).toBe("model_incompatible");
    expect(e.message).toMatch(/não oferece texto/);
    expect(e.alternatives.length).toBeGreaterThan(0);
    expect(e.alternatives.some((a) => a.model === "gpt-image-1")).toBe(false);

    await expect(
      as(ctx.actor, (s) =>
        setPreference(s, {
          scope: "user",
          task: "image_generation",
          provider: "anthropic",
          model: "claude-sonnet-5-5",
        }),
      ),
    ).rejects.toThrow(/geração de imagens/);
    await expect(
      as(ctx.actor, (s) => setPreference(s, { scope: "user", provider: "openai", model: "gpt-inexistente" })),
    ).rejects.toThrow(/não está disponível/);
  });

  it("padrão salvo que ficou indisponível não é trocado em silêncio", async () => {
    const c2 = await orgWith("Indisponível", ["anthropic", "openai"]);
    await as(c2.actor, (s) => setPreference(s, { scope: "org", provider: "anthropic", model: "claude-sonnet-5-5" }));
    await as(c2.actor, (s) => setProviderEnabled(s, "anthropic", false));
    const err = await as(c2.actor, (s) => resolveSelection(s, { module: "assistant", task: "captions" })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ModelSelectionError);
    expect((err as ModelSelectionError).reason).toBe("model_unavailable");
    expect((err as ModelSelectionError).alternatives.every((a) => a.provider === "openai")).toBe(true);
  });

  it("um padrão geral de texto não impede a geração de imagens", async () => {
    const r = await as(ctx.actor, (s) => resolveSelection(s, { module: "assistant", task: "image_generation" }));
    expect([r.def.id, r.model.id]).toEqual(["openai", "gpt-image-1"]);
  });

  it("regras puras: precedência e escolha automática", () => {
    const prefs: AiPreference[] = [
      { scope: "org", module: "", task: "", provider: "openai", model: null, priority: "balanced" },
      { scope: "user", module: "copy", task: "", provider: "anthropic", model: null, priority: "quality" },
    ];
    expect(pickPreference(prefs, { module: "copy", task: "captions" })?.level).toBe("user_module");
    expect(pickPreference(prefs, { module: "editor", task: "captions" })?.level).toBe("org");
    expect(pickPreference([], { module: "copy", task: "captions" })).toBeNull();
    const model = (id: string, tier: AiModelInfo["tier"]): AiModelInfo => ({
      id,
      label: id,
      provider: "anthropic",
      kind: "text",
      caps: { text: "yes", imageInput: "yes", imageOutput: "no", structured: "yes", effort: "yes" },
      tier,
      tierSource: "api",
      maxInputTokens: null,
      maxOutputTokens: null,
      createdAt: null,
      deprecated: false,
      price: null,
    });
    const list = [model("a", "fast"), model("b", "quality")];
    expect(autoSelect(list, "copy", "quality")?.model.id).toBe("b");
    expect(autoSelect(list, "copy", "speed")?.model.id).toBe("a");
    expect(autoSelect(list, "image_generation")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe("execução, histórico e custos", () => {
  let ctx: Awaited<ReturnType<typeof orgWith>>;

  beforeAll(async () => {
    ctx = await orgWith("Execução", ["anthropic", "openai"]);
  });

  it("a chamada chega ao modelo escolhido e o uso é registrado (custo não informado sem tabela de preço)", async () => {
    const prepared = await as(ctx.actor, (s) =>
      prepareGeneration(s, {
        operation: "captions",
        input: { topic: "Pão de Natal" },
        selection: { mode: "manual", provider: "openai", model: "gpt-5.1" },
      }),
    );
    const { events, result } = await collect(ctx.actor, prepared, { topic: "Pão de Natal" });
    expect(result.ok).toBe(true);
    const call = mock.generationCalls().find((c) => c.url === "https://api.openai.com/v1/chat/completions");
    expect(call?.body?.model).toBe("gpt-5.1");
    expect(events.map((e) => e.t)).toEqual(["meta", "chunk", "done"]);

    const [usage] = await withOrg(ctx.org.id, (tx) => tx.select().from(aiUsage).where(eq(aiUsage.model, "gpt-5.1")));
    expect(usage).toMatchObject({
      provider: "openai",
      model: "gpt-5.1",
      operation: "captions",
      module: "assistant",
      task: "captions",
      selectionSource: "explicit",
      status: "success",
      inputTokens: 90,
      outputTokens: 40,
      costMicros: null,
    });
    expect(usage?.latencyMs).not.toBeNull();
    const gens = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiGenerations).where(eq(aiGenerations.usageId, usage!.id)),
    );
    expect(gens).toHaveLength(1);
    expect(gens[0]?.output).toBe(mock.state.reply);
  });

  it("Anthropic: envia só parâmetros suportados pelo modelo e estima o custo pela tabela", async () => {
    const prepared = await as(ctx.actor, (s) =>
      prepareGeneration(s, {
        operation: "captions",
        input: { topic: "Bolo" },
        selection: { mode: "manual", provider: "anthropic", model: "claude-sonnet-5-5" },
      }),
    );
    const { result } = await collect(ctx.actor, prepared, { topic: "Bolo" });
    expect(result.ok).toBe(true);
    const call = mock.generationCalls().find((c) => c.url.startsWith("https://api.anthropic.com/v1/messages"));
    expect(call?.body?.model).toBe("claude-sonnet-5-5");
    expect(call?.body?.output_config).toEqual({ effort: "medium" });
    const [usage] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiUsage).where(eq(aiUsage.model, "claude-sonnet-5-5")),
    );
    // 120 tokens de entrada × US$ 2/M + 80 de saída × US$ 10/M = 1.040 micro-dólares.
    expect(usage?.costMicros).toBe(1040);
  });

  it("falha do provedor é registrada como erro, nunca como concluída", async () => {
    mock.state.failStatus = 500;
    const prepared = await as(ctx.actor, (s) =>
      prepareGeneration(s, {
        operation: "headlines",
        input: { topic: "Promoção" },
        selection: { mode: "manual", provider: "openai", model: "gpt-5.1-mini" },
      }),
    );
    const { events, result } = await collect(ctx.actor, prepared, { topic: "Promoção" });
    expect(result.ok).toBe(false);
    const last = events.at(-1);
    expect(last).toMatchObject({ t: "error", retryable: true });
    expect(events.some((e) => e.t === "done")).toBe(false);
    const rows = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(aiUsage)
        .where(and(eq(aiUsage.model, "gpt-5.1-mini"), eq(aiUsage.operation, "headlines"))),
    );
    expect(rows.map((r) => r.status)).toEqual(["error"]);
    const gens = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiGenerations).where(eq(aiGenerations.kind, "headlines")),
    );
    expect(gens).toHaveLength(0);
  });

  it("resposta fora do formato esperado é falha (com os tokens consumidos registrados)", async () => {
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Loja" }))).id;
    const projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Site" }))).id;
    mock.state.reply = "isto não é JSON";
    try {
      const prepared = await as(ctx.actor, (s) =>
        prepareGeneration(s, {
          operation: "task_suggestions",
          input: { topic: "Lançar site" },
          projectId,
          selection: { mode: "manual", provider: "openai", model: "gpt-5.1" },
        }),
      );
      const { result } = await collect(ctx.actor, prepared, { topic: "Lançar site" });
      expect(result.ok).toBe(false);
    } finally {
      mock.state.reply = "Legenda de teste gerada pelo modelo.";
    }
    const [row] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiUsage).where(eq(aiUsage.operation, "task_suggestions")),
    );
    expect(row).toMatchObject({ status: "error", inputTokens: 90, outputTokens: 40, projectId });
  });

  it("pede confirmação acima do limite de custo configurado", async () => {
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, confirmAboveUsd: 0.0001 }));
    const input = {
      operation: "captions",
      input: { topic: "Café" },
      selection: { mode: "manual" as const, provider: "anthropic", model: "claude-sonnet-5-5" },
    };
    await expect(as(ctx.actor, (s) => prepareGeneration(s, input))).rejects.toBeInstanceOf(CostConfirmationError);
    const ok = await as(ctx.actor, (s) => prepareGeneration(s, { ...input, confirmCost: true }));
    expect(ok.estimateMicros).toBeGreaterThan(100);
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, confirmAboveUsd: 0 }));
  });

  it("bloqueia ao atingir o limite mensal de custo", async () => {
    const c2 = await orgWith("Limite de custo", ["anthropic"]);
    await as(c2.actor, (s) =>
      recordUsage(s, {
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        operation: "captions",
        clientId: null,
        status: "success",
        costMicros: 2_000_000,
      }),
    );
    await as(c2.actor, (s) => updateAiSettings(s, { ...policy, monthlyCostLimitUsd: 1 }));
    await expect(as(c2.actor, assertCanGenerate)).rejects.toThrow(/custo/);
  });

  it("relatório mostra histórico com provedor, modelo, duração e custo (ou ausência dele)", async () => {
    const report = await as(ctx.actor, aiUsageReport);
    const byModel = Object.fromEntries(report.byModel.map((m) => [m.model, m]));
    expect(byModel["claude-sonnet-5-5"]?.cost).toBe(1040);
    expect(byModel["gpt-5.1"]?.unknownCost).toBeGreaterThan(0);
    expect(report.recent.some((r) => r.status === "error" && r.model === "gpt-5.1-mini")).toBe(true);
    expect(report.recent.every((r) => r.latencyMs !== null || r.status === "blocked")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("geração de imagens", () => {
  it("gera com o modelo de imagem escolhido, salva em Arquivos e registra o uso", async () => {
    const ctx = await orgWith("Imagens", ["anthropic", "openai"]);
    const prepared = await as(ctx.actor, (s) =>
      prepareImage(s, {
        prompt: "Panetone sobre mesa de madeira",
        size: "1024x1024",
        selection: { mode: "manual", provider: "openai", model: "gpt-image-1" },
      }),
    );
    const r = await runImage(ctx.actor, prepared);
    expect(r.ok).toBe(true);
    const call = mock.generationCalls().find((c) => c.url === "https://api.openai.com/v1/images/generations");
    expect(call?.body).toMatchObject({
      model: "gpt-image-1",
      prompt: "Panetone sobre mesa de madeira",
      size: "1024x1024",
    });
    if (!r.ok) return;
    expect(r.saved.files).toHaveLength(1);
    const [version] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(fileVersions).where(eq(fileVersions.id, r.saved.files[0]!.versionId)),
    );
    expect(version).toMatchObject({ source: "ai", mimeType: "image/png" });
    const [usage] = await withOrg(ctx.org.id, (tx) => tx.select().from(aiUsage).where(eq(aiUsage.operation, "image")));
    expect(usage).toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
      task: "image_generation",
      status: "success",
      costMicros: null,
    });
  });

  it("modelo de texto não é usado para gerar imagem: erro explica e sugere modelos visuais", async () => {
    const ctx = await orgWith("Imagens incompatíveis", ["anthropic", "openai"]);
    const err = await as(ctx.actor, (s) =>
      prepareImage(s, {
        prompt: "Logo minimalista",
        selection: { mode: "manual", provider: "anthropic", model: "claude-sonnet-5-5" },
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelSelectionError);
    expect((err as ModelSelectionError).reason).toBe("model_incompatible");
    expect((err as ModelSelectionError).alternatives.map((a) => a.model)).toEqual(["gpt-image-1"]);
  });

  it("sem provedor de imagem habilitado, explica como configurar", async () => {
    const ctx = await orgWith("Só texto", ["anthropic"]);
    const err = await as(ctx.actor, (s) => prepareImage(s, { prompt: "Logo minimalista" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelSelectionError);
    expect((err as ModelSelectionError).reason).toBe("no_compatible");
    expect((err as Error).message).toMatch(/gpt-image/);
  });

  it("falha na geração de imagem é registrada como erro e nada é salvo", async () => {
    const ctx = await orgWith("Imagem com falha", ["openai"]);
    mock.state.failStatus = 503;
    const prepared = await as(ctx.actor, (s) => prepareImage(s, { prompt: "Vitrine de Natal" }));
    const r = await runImage(ctx.actor, prepared);
    expect(r.ok).toBe(false);
    const rows = await withOrg(ctx.org.id, (tx) => tx.select().from(aiUsage));
    expect(rows.map((x) => x.status)).toEqual(["error"]);
    const versions = await withOrg(ctx.org.id, (tx) => tx.select().from(fileVersions));
    expect(versions).toHaveLength(0);
  });
});
