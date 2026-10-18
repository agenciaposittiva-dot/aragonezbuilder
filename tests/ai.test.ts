import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { organizations } from "@/server/db/schema";
import {
  assertCanGenerate,
  prepareGeneration,
  recordUsage,
  resolveProvider,
  updateAiSettings,
} from "@/server/services/ai";
import { createClient, updateBrandProfile } from "@/server/services/clients";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

describe("assistente de IA", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência IA");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Padaria Sol" }))).id;
    await as(ctx.actor, (s) =>
      updateBrandProfile(s, { clientId, toneOfVoice: "Caseiro e acolhedor", keywords: ["fermentação natural"] }),
    );
  });

  it("sem chave configurada usa o provedor de demonstração", async () => {
    const r = await as(ctx.actor, resolveProvider);
    expect(r.demo).toBe(true);
  });

  it("guarda a chave da organização criptografada", async () => {
    await as(ctx.actor, (s) =>
      updateAiSettings(s, {
        enabled: true,
        provider: "anthropic",
        model: "",
        allowClientContext: false,
        monthlyTokenLimit: 0,
        userDailyRequestLimit: 0,
        apiKey: "sk-ant-teste-1234567890",
      }),
    );
    const [org] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, ctx.org.id)),
    );
    expect(JSON.stringify(org?.settings)).not.toContain("sk-ant-teste");
    const r = await as(ctx.actor, resolveProvider);
    expect(r.demo).toBe(false);
    expect(r.keySource).toBe("org");
    expect(r.model).toBe("claude-opus-5-5");
  });

  it("não envia contexto do cliente sem autorização da organização", async () => {
    const p = await as(ctx.actor, (s) =>
      prepareGeneration(s, { operation: "captions", input: { topic: "Pão de Natal" }, clientId }),
    );
    expect(p.contextUsed).toBe(false);
    expect(p.prompt).not.toContain("Caseiro e acolhedor");
    expect(p.prompt).toContain("Pão de Natal");
  });

  it("inclui o contexto da marca quando autorizado", async () => {
    await as(ctx.actor, (s) =>
      updateAiSettings(s, {
        enabled: true,
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        allowClientContext: true,
        monthlyTokenLimit: 0,
        userDailyRequestLimit: 0,
      }),
    );
    const p = await as(ctx.actor, (s) =>
      prepareGeneration(s, { operation: "captions", input: { topic: "Pão de Natal" }, clientId }),
    );
    expect(p.contextUsed).toBe(true);
    expect(p.prompt).toContain("Caseiro e acolhedor");
    expect(p.model).toBe("claude-sonnet-5-5");
  });

  it("não aceita cliente de outra organização", async () => {
    const other = await createOrgWithOwner("Outra agência");
    await expect(
      as(other.actor, (s) => prepareGeneration(s, { operation: "captions", input: { topic: "x" }, clientId })),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("aplica o limite diário por pessoa", async () => {
    await as(ctx.actor, (s) =>
      updateAiSettings(s, {
        enabled: true,
        provider: "demo",
        model: "",
        allowClientContext: true,
        monthlyTokenLimit: 0,
        userDailyRequestLimit: 1,
      }),
    );
    await as(ctx.actor, (s) =>
      recordUsage(s, {
        provider: "demo",
        model: "demo",
        operation: "captions",
        clientId: null,
        status: "success",
        inputTokens: 10,
        outputTokens: 10,
      }),
    );
    await expect(as(ctx.actor, assertCanGenerate)).rejects.toThrow(/limite/i);
  });

  it("exige campos obrigatórios da operação", async () => {
    await expect(as(ctx.actor, (s) => prepareGeneration(s, { operation: "copy_review", input: {} }))).rejects.toThrow(
      /Preencha/,
    );
  });

  it("só quem tem permissão altera as configurações de IA", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(
      as(designer, (s) =>
        updateAiSettings(s, {
          enabled: false,
          provider: "demo",
          model: "",
          allowClientContext: false,
          monthlyTokenLimit: 0,
          userDailyRequestLimit: 0,
        }),
      ),
    ).rejects.toThrow(/permissão/i);
  });
});
