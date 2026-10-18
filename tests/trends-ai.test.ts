import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withOrg } from "@/server/db";
import { aiUsage, trendAnalyses, trends } from "@/server/db/schema";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { CostConfirmationError, updateAiSettings } from "@/server/services/ai";
import { saveProviderKey, setProviderEnabled } from "@/server/services/ai-providers";
import { createClient, updateBrandProfile } from "@/server/services/clients";
import { listTrends, refreshSources } from "@/server/services/trends";
import {
  allowedNumbers,
  classifyTrends,
  clientFit,
  generateContentPack,
  stripUnsupportedNumbers,
  TrendAiError,
} from "@/server/services/trends-ai";
import { ConnectorError } from "@/server/trends/connectors/types";
import { installAiMock } from "./ai-mocks";
import { as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Classificação, adequação por cliente e pacote de conteúdo com o provedor
 * simulado (mesmo formato da API oficial). Verifica as regras do sistema:
 * números sem respaldo saem do texto, observado nunca é alterado pela IA,
 * "em crescimento" exige evidência e temas de risco alto não são recomendados.
 */
const fx = (name: string) => readFileSync(path.join(__dirname, "fixtures", "trends", name), "utf8");
const fetchText = async (url: string) => {
  if (url.startsWith("https://trends.google.com/")) return fx("google-trends-br.xml");
  if (url.startsWith("https://wikimedia.org/")) return fx("wikimedia-top.json");
  throw new ConnectorError("A fonte respondeu 404.");
};

const KEY = "sk-ant-teste-valida-tend1";
const policy = { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };

describe("IA do Radar de Tendências", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;
  let mock: ReturnType<typeof installAiMock>;
  let festival: { id: string; metrics: unknown };
  let app: { id: string };
  let date: { id: string };
  const saved = { demo: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add(KEY);
    await resetDb();
    ctx = await createOrgWithOwner("Agência Tendências IA");
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "anthropic", KEY))).ok).toBe(true);
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cafeteria Aurora" }))).id;
    await as(ctx.actor, (s) =>
      updateBrandProfile(s, {
        clientId,
        toneOfVoice: "Acolhedor e bem-humorado",
        audience: "Jovens adultos que trabalham no centro",
        avoid: "Futebol e política",
      }),
    );
    await refreshSources(ctx.actor, { fetch: fetchText });
    const list = await as(ctx.actor, (s) => listTrends(s, { period: "30d", pageSize: 60 }));
    festival = list.rows.find((r) => r.title === "Festival de Café Fictício" && r.platform === "google_trends")!;
    app = list.rows.find((r) => r.title === "Lançamento do Aplicativo Exemplo")!;
    date = list.rows.find((r) => r.platform === "calendar")!;
    expect(festival && app && date).toBeTruthy();
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.demo;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("remove do texto números que a fonte não informou", () => {
    const allowed = allowedNumbers([
      {
        id: "x",
        title: "T",
        summary: null,
        platform: "google_trends",
        niche: null,
        region: "BR",
        eventDate: null,
        metrics: [{ key: "approx_traffic", label: "Tráfego", value: "2000+", numeric: 2000 }],
        related: [],
        growth: { growing: null, notes: [] },
      } as never,
    ]);
    const r = stripUnsupportedNumbers("Tráfego de 2000+ buscas; cresceu 350% e terá 2 milhões de views.", allowed);
    expect(r.removed).toBe(true);
    expect(r.text).toContain("2000");
    expect(r.text).not.toContain("350");
    expect(r.text).not.toContain("2 milhões");
    expect(r.text).toContain("[número sem respaldo na fonte]");
  });

  it("classifica, aplica as regras do sistema e nunca altera o observado", async () => {
    const before = await withOrg(ctx.org.id, (tx) => tx.select().from(trends).where(eq(trends.id, festival.id)));
    mock.state.reply = JSON.stringify({
      items: [
        {
          trendId: festival.id,
          type: "crescimento",
          relevance: "alta",
          velocity: "Subiu 350% em 2 horas",
          niche: "alimentacao",
          nicheFit: "Combina com cafeterias",
          audienceInterest: "alta",
          saturation: "Sem evidência de saturação.",
          reputationRisk: "baixo",
          sensitivity: "baixa",
          lifespan: "dias",
          confidence: "alta",
          angles: ["Bastidores do preparo", "Cardápio especial"],
          avoid: ["Prometer participação no evento"],
          rationale: "Fonte: 2000+ buscas. Interpretação: deve chegar a 1 milhão de pessoas e é viral.",
        },
        {
          trendId: date.id,
          type: "emergente",
          relevance: "media",
          velocity: "Não mensurável",
          niche: "datas",
          nicheFit: "Data do calendário",
          audienceInterest: "media",
          saturation: "Sem evidência de saturação.",
          reputationRisk: "baixo",
          sensitivity: "media",
          lifespan: "recorrente",
          confidence: "alta",
          angles: ["Homenagem"],
          avoid: [],
          rationale: "Data comemorativa.",
        },
        {
          ...{ trendId: "00000000-0000-4000-8000-000000000000" },
          type: "emergente",
          relevance: "alta",
          velocity: "",
          niche: "outros",
          nicheFit: "",
          audienceInterest: "alta",
          saturation: "",
          reputationRisk: "baixo",
          sensitivity: "baixa",
          lifespan: "dias",
          confidence: "alta",
          angles: [],
          avoid: [],
          rationale: "inventado",
        },
      ],
    });
    const r = await classifyTrends(ctx.actor, { trendIds: [festival.id, date.id] });
    expect(r).toMatchObject({ classified: 2, missing: 0, demo: false });

    const rows = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(trendAnalyses).where(eq(trendAnalyses.kind, "classification")),
    );
    expect(rows).toHaveLength(2);
    const f = rows.find((x) => x.trendId === festival.id)!;
    // Sem duas coletas não há evidência de crescimento: vira "emergente".
    expect(f.trendType).toBe("emergente");
    expect(f.velocity).toMatch(/Não mensurável/);
    expect(f.rationale).toContain("2000+");
    expect(f.rationale).not.toContain("1 milhão");
    expect(f.guardrails.join(" ")).toMatch(/crescimento/);
    const d = rows.find((x) => x.trendId === date.id)!;
    expect(d.trendType).toBe("sazonal");
    // Datas não têm indicadores: confiança limitada a média.
    expect(d.confidence).toBe("media");

    // O que a fonte informou continua igual.
    const after = await withOrg(ctx.org.id, (tx) => tx.select().from(trends).where(eq(trends.id, festival.id)));
    expect(after[0]!.metrics).toEqual(before[0]!.metrics);

    // O prompt leva só os dados observados.
    const body = JSON.stringify(mock.generationCalls()[0]!.body);
    expect(body).toContain("2000+");
    expect(body).toContain("Formato da resposta: trend_classification");

    const usage = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiUsage).where(eq(aiUsage.operation, "trend_classification")),
    );
    expect(usage.map((u) => u.status)).toEqual(["success"]);
  });

  it("falha do provedor é registrada como erro e nada é gravado como análise", async () => {
    mock.state.failStatus = 500;
    const count = async () =>
      (await withOrg(ctx.org.id, (tx) => tx.select().from(trendAnalyses).where(eq(trendAnalyses.trendId, app.id))))
        .length;
    const before = await count();
    await expect(classifyTrends(ctx.actor, { trendIds: [app.id] })).rejects.toBeInstanceOf(TrendAiError);
    expect(await count()).toBe(before);
    const usage = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(aiUsage)
        .where(and(eq(aiUsage.operation, "trend_classification"), eq(aiUsage.status, "error"))),
    );
    expect(usage).toHaveLength(1);
  });

  it("resposta fora do formato também é erro (não vira sucesso)", async () => {
    mock.state.reply = "não é JSON";
    await expect(classifyTrends(ctx.actor, { trendIds: [app.id] })).rejects.toBeInstanceOf(TrendAiError);
  });

  it("pede confirmação de custo acima do limite da organização", async () => {
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, confirmAboveUsd: 0.000001 }));
    await expect(classifyTrends(ctx.actor, { trendIds: [app.id] })).rejects.toBeInstanceOf(CostConfirmationError);
    expect(mock.generationCalls()).toHaveLength(0);
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, confirmAboveUsd: 0 }));
  });

  it("por cliente: exige autorização para dados de clientes", async () => {
    await expect(clientFit(ctx.actor, { clientId })).rejects.toBeInstanceOf(ValidationError);
    expect(mock.generationCalls()).toHaveLength(0);
  });

  it("por cliente: explica o encaixe e nunca recomenda tema de risco alto", async () => {
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: true }));
    mock.state.reply = JSON.stringify({
      recommendations: [
        {
          trendId: festival.id,
          recommended: true,
          fit: "Tema de café combina com a marca.",
          angles: ["Bebida especial do festival"],
          avoid: ["Tom oportunista"],
          reputationRisk: "baixo",
          confidence: "media",
        },
        {
          trendId: app.id,
          recommended: true,
          fit: "Pode render humor, cresceu 900%.",
          angles: [],
          avoid: [],
          reputationRisk: "alto",
          confidence: "baixa",
        },
        {
          trendId: "00000000-0000-4000-8000-000000000000",
          recommended: true,
          fit: "x",
          angles: [],
          avoid: [],
          reputationRisk: "baixo",
          confidence: "alta",
        },
      ],
      notes: "Evite futebol, conforme o perfil.",
    });
    const r = await clientFit(ctx.actor, { clientId, period: "7d" });
    expect(r.clientName).toBe("Cafeteria Aurora");
    expect(r.recommended.map((x) => x.trendId)).toEqual([festival.id]);
    expect(r.notRecommended.map((x) => x.trendId)).toEqual([app.id]);
    expect(r.notRecommended[0]!.fit).not.toContain("900");
    expect(r.notRecommended[0]!.guardrails.join(" ")).toMatch(/risco/i);
    expect(r.discarded).toBe(1);
    const body = JSON.stringify(mock.generationCalls()[0]!.body);
    expect(body).toContain("Jovens adultos que trabalham no centro");
    expect(body).toContain("Futebol e política");
  });

  it("pacote de conteúdo: sem números inventados e recusado para tema não recomendado à marca", async () => {
    mock.state.reply = JSON.stringify({
      title: "Café do festival",
      concept: "Conectar a cafeteria ao festival.",
      strategy: "Aproveitar o interesse local.",
      copy: "O festival chegou. E o nosso café também.",
      caption: "Já são 3 milhões falando disso! Venha provar.",
      cta: "Passe aqui hoje",
      script: "",
      visualDirection: "Xícara em close, luz quente.",
      imagePrompt: "Xícara de café sobre mesa de madeira, luz quente, sem texto",
      hashtags: ["#cafe"],
      slides: [{ title: "Capa", text: "Festival" }],
    });
    const r = await generateContentPack(ctx.actor, { trendId: festival.id, clientId, formats: ["feed", "carousel"] });
    expect(r.pack.caption).not.toContain("3 milhões");
    expect(r.guardrails.length).toBeGreaterThan(0);
    expect(r.brandContextUsed).toBe(true);
    expect(r.analysisId).toBeTruthy();
    const body = JSON.stringify(mock.generationCalls()[0]!.body);
    expect(body).toContain("Não use a palavra viral");

    await expect(
      generateContentPack(ctx.actor, { trendId: app.id, clientId, formats: ["feed"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("modo demonstração ativado pela organização: respostas identificadas e sem números", async () => {
    await as(ctx.actor, (s) => setProviderEnabled(s, "demo", true));
    const r = await classifyTrends(ctx.actor, {
      trendIds: [app.id],
      selection: { mode: "manual", provider: "demo", model: "demo" },
    });
    expect(r).toMatchObject({ classified: 1, demo: true });
    expect(mock.generationCalls()).toHaveLength(0);
    const [row] = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(trendAnalyses)
        .where(and(eq(trendAnalyses.trendId, app.id), eq(trendAnalyses.demo, true))),
    );
    expect(row!.rationale).toMatch(/Modo demonstração/);
    expect(row!.rationale).not.toMatch(/\d/);
  });
});
