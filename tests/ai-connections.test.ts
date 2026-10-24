import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEndpointUrl, isPrivateIp } from "@/lib/endpoint-url";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { withOrg, withSystem } from "@/server/db";
import { aiUsage, aiUserConnections, auditLogs } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { prepareGeneration, updateAiSettings } from "@/server/services/ai";
import {
  listMyConnections,
  myAiUsage,
  personalConnectionStats,
  removeMyConnection,
  resetConnectionRateLimit,
  saveMyConnection,
  setMyConnectionEnabled,
  testMyConnection,
  validateEndpointUrl,
} from "@/server/services/ai-connections";
import { getPickerData, resolveSelection, setPreference } from "@/server/services/ai-models";
import { saveProviderKey, setProviderUserKeysAllowed } from "@/server/services/ai-providers";
import { runGeneration } from "@/server/services/ai-run";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * BYOK — conexões de IA pessoais: criptografia e mascaramento, cadastro com
 * validação real (simulada), isolamento entre pessoas e organizações,
 * precedência (pessoal > organização > servidor), política da organização,
 * endereço personalizado (SSRF), limite de tentativas e consumo separado.
 * Nenhuma chamada sai da máquina.
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const ORG_KEY = "sk-openai-org-chave-0001";
const MY_KEY = "sk-openai-minha-chave-0002";
const OTHER_KEY = "sk-openai-outra-pessoa-0003";
const ANTHROPIC_KEY = "sk-ant-pessoal-0004";
const policy = { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };
const publicResolver = async () => ["93.184.216.34"];

describe("BYOK — regras puras", () => {
  it("criptografia autenticada: ida e volta, token adulterado não abre, máscara só mostra o final", () => {
    const token = encryptSecret("sk-live-abc123xyz");
    expect(token.startsWith("v1.")).toBe(true);
    expect(token).not.toContain("abc123");
    expect(decryptSecret(token)).toBe("sk-live-abc123xyz");
    expect(decryptSecret(`${token.slice(0, -2)}zz`)).toBeNull();
    expect(decryptSecret("lixo")).toBeNull();
    expect(maskSecret("sk-live-abc123xyz")).toBe("••••3xyz");
  });

  it("endereço personalizado: só https e nunca endereços internos", () => {
    expect(checkEndpointUrl("https://gateway.example.com/v1/")).toMatchObject({
      ok: true,
      url: "https://gateway.example.com/v1",
    });
    expect(checkEndpointUrl("http://gateway.example.com")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://user:pass@gateway.example.com")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://localhost:8443")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://127.0.0.1")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://10.0.0.5/v1")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://169.254.169.254/latest")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://[::1]/v1")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://api.internal")).toMatchObject({ ok: false });
    expect(checkEndpointUrl("https://gateway.example.com:8443")).toMatchObject({ ok: false });
    expect(isPrivateIp("172.16.4.2")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);
  });

  it("nome que resolve para IP privado é recusado; nome não resolvido também", async () => {
    await expect(validateEndpointUrl("https://evil.example.com", async () => ["10.1.1.1"])).rejects.toThrow(/internos/);
    await expect(
      validateEndpointUrl("https://nao-existe.example.com", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/resolver/);
    await expect(validateEndpointUrl("https://ok.gateway.test/v1", publicResolver)).resolves.toBe(
      "https://ok.gateway.test/v1",
    );
  });
});

describe("BYOK — conexões pessoais", () => {
  let a: Ctx;
  let b: Ctx;
  let colleague: Awaited<ReturnType<typeof addMember>>;
  let mock: ReturnType<typeof installAiMock>;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, openai: env.OPENAI_API_KEY, anthropic: env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.OPENAI_API_KEY = undefined;
    env.ANTHROPIC_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.openai.add(ORG_KEY);
    mock.state.valid.openai.add(MY_KEY);
    mock.state.valid.openai.add(OTHER_KEY);
    mock.state.valid.anthropic.add(ANTHROPIC_KEY);
    await resetDb();
    a = await createOrgWithOwner("Agência BYOK");
    b = await createOrgWithOwner("Agência Vizinha");
    await as(a.actor, (s) => updateAiSettings(s, policy));
    await as(b.actor, (s) => updateAiSettings(s, policy));
    colleague = await addMember(a.org.slug, a.org.id, "designer");
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.OPENAI_API_KEY = saved.openai;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mock.reset();
    resetConnectionRateLimit();
  });

  it("lista os provedores com chave; chave inválida não é salva e nada vaza em erros ou auditoria", async () => {
    const before = await as(a.actor, (s) => listMyConnections(s));
    expect(before.map((c) => c.provider)).toEqual(["anthropic", "openai", "gemini", "magnific"]);
    expect(before.every((c) => c.state === "not_configured" && c.allowed)).toBe(true);
    expect(before.find((c) => c.provider === "openai")?.customEndpoint).toBe(true);
    expect(before.find((c) => c.provider === "anthropic")?.customEndpoint).toBe(false);

    const bad = await as(a.actor, (s) => saveMyConnection(s, { provider: "openai", apiKey: "sk-openai-errada-9999" }));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/inválida/);
    expect(bad.error).not.toContain("errada-9999");
    expect(await withOrg(a.org.id, (tx) => tx.select().from(aiUserConnections))).toEqual([]);
    const logs = await withOrg(a.org.id, (tx) => tx.select().from(auditLogs));
    expect(JSON.stringify(logs)).not.toContain("errada-9999");
  });

  it("cadastro válido: criptografada, mascarada, estado funcionando, modelos listados; outra pessoa não a vê", async () => {
    const res = await as(a.actor, (s) => saveMyConnection(s, { provider: "openai", apiKey: MY_KEY }));
    expect(res).toMatchObject({ ok: true, models: 3 });
    const [row] = await withOrg(a.org.id, (tx) => tx.select().from(aiUserConnections));
    expect(row).toMatchObject({ userId: a.owner.id, provider: "openai", status: "valid", enabled: true });
    expect(row!.keyEncrypted).not.toContain(MY_KEY);
    expect(decryptSecret(row!.keyEncrypted)).toBe(MY_KEY);

    const mine = (await as(a.actor, (s) => listMyConnections(s))).find((c) => c.provider === "openai")!;
    expect(mine).toMatchObject({ state: "working", enabled: true, keyMask: "••••0002", endpointUrl: null });
    expect(mine.models.map((m) => m.id)).toContain("gpt-image-1");
    expect(JSON.stringify(mine)).not.toContain(MY_KEY);

    // Colega da mesma organização: nada configurado para ela.
    const theirs = (await as(colleague, (s) => listMyConnections(s))).find((c) => c.provider === "openai")!;
    expect(theirs.state).toBe("not_configured");
    await expect(as(colleague, (s) => testMyConnection(s, "openai"))).rejects.toThrow(/ainda não conectou/);
    // Outra organização: nem a linha existe no escopo dela.
    expect(await withOrg(b.org.id, (tx) => tx.select().from(aiUserConnections))).toEqual([]);
  });

  it("precedência: chave pessoal válida vale antes da chave da organização, só para quem a cadastrou", async () => {
    expect((await as(a.actor, (s) => saveProviderKey(s, "openai", ORG_KEY))).ok).toBe(true);
    const mineResolved = await as(a.actor, (s) =>
      resolveSelection(s, { module: "assistant", task: "copy", selection: { mode: "manual", provider: "openai" } }),
    );
    expect(mineResolved).toMatchObject({ apiKey: MY_KEY, keySource: "user", baseUrl: null });
    const colleagueResolved = await as(colleague, (s) =>
      resolveSelection(s, { module: "assistant", task: "copy", selection: { mode: "manual", provider: "openai" } }),
    );
    expect(colleagueResolved).toMatchObject({ apiKey: ORG_KEY, keySource: "org" });

    // Desativada: volta para a chave da organização; reativada: pessoal de novo.
    await as(a.actor, (s) => setMyConnectionEnabled(s, "openai", false));
    expect(
      (
        await as(a.actor, (s) =>
          resolveSelection(s, { module: "assistant", task: "copy", selection: { mode: "manual", provider: "openai" } }),
        )
      ).keySource,
    ).toBe("org");
    await as(a.actor, (s) => setMyConnectionEnabled(s, "openai", true));

    // O seletor mostra o provedor como pessoal e o padrão por finalidade aceita o modelo.
    const picker = await as(a.actor, (s) => getPickerData(s));
    expect(picker.providers.find((p) => p.id === "openai")).toMatchObject({ ready: true, personal: true });
    await as(a.actor, (s) =>
      setPreference(s, {
        scope: "user",
        task: "copy",
        provider: "openai",
        model: "gpt-5.1-mini",
        priority: "balanced",
      }),
    );
  });

  it("uso registra a origem da credencial e o consumo pessoal fica separado do compartilhado", async () => {
    const prepared = await as(a.actor, (s) =>
      prepareGeneration(s, {
        operation: "captions",
        module: "assistant",
        input: { topic: "Lançamento de inverno" },
        selection: { mode: "manual", provider: "openai", model: "gpt-5.1-mini" },
      }),
    );
    expect(prepared.keySource).toBe("user");
    const events: unknown[] = [];
    const run = await runGeneration(
      a.actor,
      prepared,
      { topic: "Lançamento de inverno" },
      { send: (e) => events.push(e) },
    );
    expect(run.ok).toBe(true);
    const call = mock.calls.find((c) => c.url.includes("/v1/chat/completions"))!;
    expect(call.headers.get("authorization")).toBe(`Bearer ${MY_KEY}`);
    const rows = await withOrg(a.org.id, (tx) =>
      tx
        .select()
        .from(aiUsage)
        .where(and(eq(aiUsage.userId, a.owner.id), eq(aiUsage.status, "success"))),
    );
    expect(rows.at(-1)?.keySource).toBe("user");
    const usage = await as(a.actor, (s) => myAiUsage(s));
    expect(usage.personal.requests).toBeGreaterThanOrEqual(1);
    expect(usage.shared.requests).toBe(0);
  });

  it("política da organização: bloqueio geral e por provedor impedem cadastrar e usar a chave pessoal", async () => {
    await as(a.actor, (s) => setProviderUserKeysAllowed(s, "openai", false));
    const blocked = (await as(a.actor, (s) => listMyConnections(s))).find((c) => c.provider === "openai")!;
    expect(blocked.allowed).toBe(false);
    expect(blocked.policyReason).toMatch(/provedor/);
    await expect(
      as(a.actor, (s) => saveMyConnection(s, { provider: "openai", apiKey: MY_KEY })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (
        await as(a.actor, (s) =>
          resolveSelection(s, { module: "assistant", task: "copy", selection: { mode: "manual", provider: "openai" } }),
        )
      ).keySource,
    ).toBe("org");
    await as(a.actor, (s) => setProviderUserKeysAllowed(s, "openai", true));

    await as(a.actor, (s) => updateAiSettings(s, { ...policy, allowPersonalKeys: false }));
    await expect(
      as(a.actor, (s) => saveMyConnection(s, { provider: "anthropic", apiKey: ANTHROPIC_KEY })),
    ).rejects.toThrow(/não permite chaves/);
    expect(
      (await as(a.actor, (s) => getPickerData(s))).providers.find((p) => p.id === "openai")?.personal,
    ).toBeUndefined();
    await as(a.actor, (s) => updateAiSettings(s, { ...policy, allowPersonalKeys: true }));

    const stats = await as(a.actor, (s) => personalConnectionStats(s));
    expect(stats.openai).toEqual({ total: 1, working: 1 });
    await expect(as(colleague, (s) => personalConnectionStats(s))).rejects.toThrow();
  });

  it("endereço personalizado: validado (SSRF), usado na chamada real e recusado em provedor sem suporte", async () => {
    await expect(
      as(a.actor, (s) =>
        saveMyConnection(
          s,
          { provider: "openai", endpointUrl: "https://evil.gateway.test" },
          { resolve: async () => ["10.0.0.9"] },
        ),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      as(a.actor, (s) => saveMyConnection(s, { provider: "openai", endpointUrl: "http://plain.gateway.test" })),
    ).rejects.toThrow(/https/);

    const res = await as(a.actor, (s) =>
      saveMyConnection(s, { provider: "openai", endpointUrl: "https://ok.gateway.test/" }, { resolve: publicResolver }),
    );
    expect(res.ok).toBe(true);
    const probe = mock.calls.find((c) => c.url === "https://ok.gateway.test/v1/models")!;
    expect(probe.headers.get("authorization")).toBe(`Bearer ${MY_KEY}`);
    const resolved = await as(a.actor, (s) =>
      resolveSelection(s, { module: "assistant", task: "copy", selection: { mode: "manual", provider: "openai" } }),
    );
    expect(resolved).toMatchObject({ keySource: "user", baseUrl: "https://ok.gateway.test" });

    await expect(
      as(a.actor, (s) =>
        saveMyConnection(s, { provider: "anthropic", apiKey: ANTHROPIC_KEY, endpointUrl: "https://ok.gateway.test" }),
      ),
    ).rejects.toThrow(/não aceita endereço/);
  });

  it("testar conexão: falha do provedor vira estado de erro e volta a funcionar; remover apaga a chave", async () => {
    mock.state.valid.openai.delete(MY_KEY);
    const failed = await as(a.actor, (s) => testMyConnection(s, "openai"));
    expect(failed.ok).toBe(false);
    let mine = (await as(a.actor, (s) => listMyConnections(s))).find((c) => c.provider === "openai")!;
    expect(mine.state).toBe("error");
    // Pessoal inválida: a escolha cai para a chave da organização, sem troca silenciosa de modelo.
    expect(
      (
        await as(a.actor, (s) =>
          resolveSelection(s, { module: "assistant", task: "copy", selection: { mode: "manual", provider: "openai" } }),
        )
      ).keySource,
    ).toBe("org");

    mock.state.valid.openai.add(MY_KEY);
    expect((await as(a.actor, (s) => testMyConnection(s, "openai"))).ok).toBe(true);
    mine = (await as(a.actor, (s) => listMyConnections(s))).find((c) => c.provider === "openai")!;
    expect(mine.state).toBe("working");

    await as(a.actor, (s) => removeMyConnection(s, "openai"));
    expect(await withOrg(a.org.id, (tx) => tx.select().from(aiUserConnections))).toEqual([]);
    expect((await as(a.actor, (s) => listMyConnections(s))).find((c) => c.provider === "openai")?.state).toBe(
      "not_configured",
    );
  });

  it("limite de tentativas de validação por pessoa", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await as(colleague, (s) =>
        saveMyConnection(s, { provider: "openai", apiKey: `sk-openai-tentativa-${i}` }),
      );
      expect(r.ok).toBe(false);
    }
    await expect(as(colleague, (s) => saveMyConnection(s, { provider: "openai", apiKey: OTHER_KEY }))).rejects.toThrow(
      /Muitas tentativas/,
    );
    resetConnectionRateLimit();
    expect((await as(colleague, (s) => saveMyConnection(s, { provider: "openai", apiKey: OTHER_KEY }))).ok).toBe(true);
    // A chave da colega não aparece para o dono nem vice-versa.
    const owner = (await as(a.actor, (s) => listMyConnections(s))).find((c) => c.provider === "openai")!;
    expect(owner.state).toBe("not_configured");
    const rows = await withSystem((tx) => tx.select().from(aiUserConnections));
    expect(rows.map((r) => r.userId)).toEqual([colleague.userId]);
  });
});
