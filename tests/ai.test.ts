import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "@/server/crypto";
import { withOrg } from "@/server/db";
import { aiProviderConfigs, organizations } from "@/server/db/schema";
import { env } from "@/server/env";
import {
  assertCanGenerate,
  prepareGeneration,
  recordUsage,
  resolveProvider,
  updateAiSettings,
} from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { providerStates, saveProviderKey } from "@/server/services/ai-providers";
import { createClient, updateBrandProfile } from "@/server/services/clients";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

const ANTHROPIC_KEY = "sk-ant-teste-valida-0001";
const policy = { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };

describe("assistente de IA", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;
  let mock: ReturnType<typeof installAiMock>;
  const saved = { demo: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    // Ambiente sem chaves do servidor e sem a demonstração ligada por padrão.
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add(ANTHROPIC_KEY);
    await resetDb();
    ctx = await createOrgWithOwner("Agência IA");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Padaria Sol" }))).id;
    await as(ctx.actor, (s) =>
      updateBrandProfile(s, { clientId, toneOfVoice: "Caseiro e acolhedor", keywords: ["fermentação natural"] }),
    );
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.demo;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    vi.unstubAllGlobals();
  });

  it("sem provedor configurado a IA fica 'não configurada' (sem respostas simuladas)", async () => {
    const r = await as(ctx.actor, resolveProvider);
    expect(r.configured).toBe(false);
    const err = await as(ctx.actor, (s) =>
      prepareGeneration(s, { operation: "captions", input: { topic: "Pão" } }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelSelectionError);
    expect((err as ModelSelectionError).reason).toBe("no_provider");
    expect(mock.calls).toHaveLength(0);
  });

  it("valida a chave com a API do provedor antes de guardá-la criptografada e habilitar", async () => {
    const r = await as(ctx.actor, (s) => saveProviderKey(s, "anthropic", ANTHROPIC_KEY));
    expect(r.ok).toBe(true);
    expect(mock.calls.some((c) => c.url.startsWith("https://api.anthropic.com/v1/models"))).toBe(true);

    const [row] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.provider, "anthropic")),
    );
    expect(row?.keyEncrypted).toBeTruthy();
    expect(row?.keyEncrypted).not.toContain(ANTHROPIC_KEY);
    expect(decryptSecret(row!.keyEncrypted!)).toBe(ANTHROPIC_KEY);
    expect(row?.enabled).toBe(true);
    expect(row?.status).toBe("valid");
    expect(row?.models.map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);

    const [org] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, ctx.org.id)),
    );
    expect(JSON.stringify(org?.settings)).not.toContain(ANTHROPIC_KEY);

    const summary = await as(ctx.actor, resolveProvider);
    expect(summary.configured).toBe(true);
    const [state] = (await as(ctx.actor, (s) => providerStates(s, { admin: true }))).filter(
      (p) => p.id === "anthropic",
    );
    expect(state?.keySource).toBe("org");
    expect(state?.keyMask).toBe("••••0001");
  });

  it("não envia contexto do cliente sem autorização da organização", async () => {
    const p = await as(ctx.actor, (s) =>
      prepareGeneration(s, { operation: "captions", input: { topic: "Pão de Natal" }, clientId }),
    );
    expect(p.contextUsed).toBe(false);
    expect(p.prompt).not.toContain("Caseiro e acolhedor");
    expect(p.prompt).toContain("Pão de Natal");
    expect(p.providerId).toBe("anthropic");
  });

  it("inclui o contexto da marca quando autorizado e respeita o modelo padrão da organização", async () => {
    await as(ctx.actor, (s) =>
      updateAiSettings(s, { ...policy, allowClientContext: true, provider: "anthropic", model: "claude-haiku-5-5" }),
    );
    const p = await as(ctx.actor, (s) =>
      prepareGeneration(s, { operation: "captions", input: { topic: "Pão de Natal" }, clientId }),
    );
    expect(p.contextUsed).toBe(true);
    expect(p.prompt).toContain("Caseiro e acolhedor");
    expect(p.model.id).toBe("claude-haiku-5-5");
    expect(p.source).toBe("org");
  });

  it("não aceita cliente de outra organização", async () => {
    const other = await createOrgWithOwner("Outra agência");
    await as(other.actor, (s) => saveProviderKey(s, "anthropic", ANTHROPIC_KEY));
    await expect(
      as(other.actor, (s) => prepareGeneration(s, { operation: "captions", input: { topic: "x" }, clientId })),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("aplica o limite diário por pessoa", async () => {
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: true, userDailyRequestLimit: 1 }));
    await as(ctx.actor, (s) =>
      recordUsage(s, {
        provider: "anthropic",
        model: "claude-haiku-5-5",
        operation: "captions",
        clientId: null,
        status: "success",
        inputTokens: 10,
        outputTokens: 10,
      }),
    );
    await expect(as(ctx.actor, assertCanGenerate)).rejects.toThrow(/limite/i);
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, userDailyRequestLimit: 0 }));
  });

  it("exige campos obrigatórios da operação", async () => {
    await expect(as(ctx.actor, (s) => prepareGeneration(s, { operation: "copy_review", input: {} }))).rejects.toThrow(
      /Preencha/,
    );
  });

  it("só quem tem permissão altera as configurações e as chaves de IA", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(as(designer, (s) => updateAiSettings(s, { ...policy, enabled: false }))).rejects.toThrow(/permissão/i);
    await expect(as(designer, (s) => saveProviderKey(s, "anthropic", ANTHROPIC_KEY))).rejects.toThrow(/permissão/i);
    await expect(as(designer, (s) => providerStates(s, { admin: true }))).rejects.toThrow(/permissão/i);
  });
});

describe("modelo padrão do Gemini", () => {
  it("escolhe o flash estável de versão mais alta, ignorando variantes especiais", async () => {
    const { pickDefaultModel } = await import("@/server/ai/providers/gemini");
    expect(
      pickDefaultModel([
        "gemini-3.1-pro",
        "gemini-3-flash-preview",
        "gemini-3.5-flash",
        "gemini-3.1-flash",
        "gemini-3.5-flash-image",
      ]),
    ).toBe("gemini-3.5-flash");
    expect(pickDefaultModel(["gemini-3-flash-preview", "gemini-3.6-flash-tts"])).toBe("gemini-3-flash-preview");
    expect(pickDefaultModel(["text-embedding-004"])).toBeNull();
  });
});

describe("modelo padrão da OpenAI", () => {
  it("escolhe o GPT principal de versão mais alta; sem ele, o mini", async () => {
    const { pickDefaultOpenAiModel } = await import("@/server/ai/providers/openai");
    expect(pickDefaultOpenAiModel(["gpt-5", "gpt-5.1", "gpt-5.1-mini", "gpt-4o", "gpt-realtime", "dall-e-3"])).toBe(
      "gpt-5.1",
    );
    expect(pickDefaultOpenAiModel(["gpt-5-mini", "whisper-1"])).toBe("gpt-5-mini");
    expect(pickDefaultOpenAiModel(["text-embedding-3-small"])).toBeNull();
  });
});
