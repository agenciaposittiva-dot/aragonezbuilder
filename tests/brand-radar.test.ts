import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableRequirements,
  completenessScore,
  countChars,
  EMPTY_MANUAL,
  formatsScore,
  normalizeHandle,
  normalizeWeights,
  overallScore,
  performanceScore,
  type DiagnosisInputs,
  type DiagnosisResult,
} from "@/lib/brand-radar";
import { withOrg } from "@/server/db";
import {
  approvals,
  brandRadarBioVersions,
  brandRadarConnections,
  brandRadarRecommendations,
  contentItems,
  designs,
  roles,
  tasks,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { updateAiSettings } from "@/server/services/ai";
import { saveProviderKey, setProviderEnabled } from "@/server/services/ai-providers";
import {
  bioToTask,
  buildInputs,
  chooseBioVersion,
  compareDiagnoses,
  contentIdeaToContent,
  createRadarProfile,
  getRadarWorkspace,
  highlightToDesign,
  highlightToTask,
  listRadarProfiles,
  recommendationToContent,
  recommendationToDesign,
  recommendationToTask,
  saveBioVersion,
  saveManualInputs,
  sendBioForApproval,
  updateRadarSettings,
  updateRecommendation,
} from "@/server/services/brand-radar";
import {
  applyDiagnosisRules,
  applyNicheRules,
  BrandAiError,
  diagnosisResponse,
  nicheResponse,
  runBrandAi,
} from "@/server/services/brand-radar-ai";
import { createClient, setClientMembers, updateBrandProfile } from "@/server/services/clients";
import { storeUpload } from "@/server/services/files";
import { saveRole } from "@/server/services/roles";
import {
  completeInstagramConnection,
  disconnectInstagram,
  exchangeCode,
  fetchMedia,
  instagramConnectUrl,
  instagramState,
  InstagramError,
  signState,
  syncInstagram,
  TokenInvalidError,
  verifyState,
} from "@/server/services/instagram";
import { installAiMock, TINY_PNG } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Radar de Marca: regras objetivas da pontuação, regras do sistema sobre a
 * resposta da IA, fluxo completo com o provedor de demonstração e com o
 * provedor simulado (com imagens), integrações (tarefas, artes, conteúdos,
 * aprovações), permissões por cliente e a conexão oficial com o Instagram
 * (respostas da API da Meta simuladas — nada sai da máquina).
 */

const NOW = "2026-10-18T12:00:00.000Z";

function baseInputs(over: Partial<DiagnosisInputs> = {}): DiagnosisInputs {
  return {
    handle: "cafe.aurora",
    profileUrl: "https://www.instagram.com/cafe.aurora/",
    sources: [],
    profile: {
      displayName: { value: "Café Aurora", source: "manual", collectedAt: NOW },
      category: null,
      bio: { value: "Cafés especiais no centro. Peça pelo link", source: "manual", collectedAt: NOW },
      link: { value: "https://cafe.example/pedido", source: "manual", collectedAt: NOW },
      followers: { value: 1200, source: "manual", collectedAt: NOW },
      following: null,
      postsCount: null,
    },
    highlights: null,
    posts: null,
    screenshots: [],
    brand: null,
    niche: { niche: null, market: null, region: null },
    goals: "",
    notes: "",
    competitors: [],
    missing: [],
    ...over,
  };
}

function aiReply(over: Record<string, unknown> = {}) {
  return {
    summary: "Perfil com boa base; a bio pode ser mais clara. Cresceu 45% no último mês.",
    strengths: [{ text: "Nome claro", basis: "observed", evidence: "Nome de exibição: Café Aurora" }],
    problems: [{ text: "Falta prova social", basis: "observed", evidence: "" }],
    opportunities: [{ text: "Mostrar bastidores", basis: "hypothesis", evidence: "" }],
    dimensions: [
      { key: "positioning", score: 70, rationale: "Clara", evidence: "Bio" },
      { key: "bio", score: 64.6, rationale: "Ok", evidence: "Bio" },
      { key: "visual", score: 90, rationale: "Bonito", evidence: "" },
      { key: "content", score: 80, rationale: "Bom", evidence: "" },
      { key: "performance", score: 95, rationale: "Ótimo engajamento", evidence: "" },
      { key: "cta", score: 50, rationale: "Fraca", evidence: "" },
    ],
    bio: {
      audit: [{ criterion: "Chamada para ação", assessment: "ok", note: "Tem link" }],
      versions: [
        {
          style: "creative",
          text: "Café que abraça. Peça pelo link",
          objective: "x",
          strengths: [],
          cta: "Peça",
          warnings: [],
        },
        {
          style: "direct",
          text: "Mais de 5000 clientes atendidos. Peça já",
          objective: "y",
          strengths: [],
          cta: "Peça",
          warnings: [],
        },
        { style: "strategic", text: "a".repeat(200), objective: "z", strengths: [], cta: "", warnings: [] },
      ],
    },
    highlights: {
      assessment: "Bons",
      basis: "observed",
      recommended: [
        {
          name: "Cardápio",
          objective: "Mostrar",
          order: 1,
          storyIdeas: ["Foto"],
          coverDirection: "Ícone",
          coverPrompt: "ícone",
        },
      ],
    },
    visual: { note: "Cores fortes", items: [{ criterion: "Cores", assessment: "Consistentes", basis: "observed" }] },
    content: { categories: [{ key: "education", presence: "present", note: "Muitos posts" }], recommendations: [] },
    recommendations: [
      {
        area: "bio",
        category: "fix_now",
        title: "Ajustar a bio",
        problem: "Pouco clara",
        evidence: "",
        evidenceSource: "",
        basis: "observed",
        impact: "alto",
        effort: "baixo",
        priority: 9,
        confidence: "altissimo",
        nextAction: "Trocar",
        howToTest: "Comparar cliques",
      },
    ],
    plan30: [{ week: 1, focus: "Bio", actions: ["Trocar a bio"] }],
    ...over,
  };
}

describe("Radar de Marca — regras objetivas", () => {
  it("aceita @, nome e endereço do perfil; recusa o que não é um @ válido", () => {
    expect(normalizeHandle("@Cafe.Aurora")).toBe("cafe.aurora");
    expect(normalizeHandle("https://www.instagram.com/cafe_aurora/?hl=pt")).toBe("cafe_aurora");
    expect(normalizeHandle("instagram.com/loja.x")).toBe("loja.x");
    expect(normalizeHandle("nome com espaço")).toBeNull();
    expect(normalizeHandle(".comeca.com.ponto")).toBeNull();
    expect(normalizeHandle("a".repeat(31))).toBeNull();
  });

  it("conta caracteres como o público vê (emoji vale um)", () => {
    expect(countChars("Café ☕")).toBe(6);
    expect(countChars("👩‍💻")).toBeGreaterThanOrEqual(1);
  });

  it("completude: conferência automática, destaques desconhecidos ficam fora da conta", () => {
    const r = completenessScore(baseInputs(), 150);
    expect(r.checks.find((c) => c.label === "Destaques")?.ok).toBeNull();
    expect(r.score).toBe(100);
    const over = completenessScore(
      baseInputs({
        profile: { ...baseInputs().profile, bio: { value: "x".repeat(151), source: "manual", collectedAt: NOW } },
      }),
      150,
    );
    expect(over.checks.find((c) => c.label.startsWith("Bio dentro"))?.ok).toBe(false);
    const empty = completenessScore(
      baseInputs({
        profile: {
          displayName: null,
          category: null,
          bio: null,
          link: null,
          followers: null,
          following: null,
          postsCount: null,
        },
      }),
      150,
    );
    expect(empty.score).toBeNull();
  });

  it("formatos: exige ao menos 3 publicações com formato conhecido", () => {
    expect(formatsScore(baseInputs()).score).toBeNull();
    const posts = {
      source: "manual" as const,
      collectedAt: NOW,
      items: [
        { format: "image" as const, text: "a" },
        { format: "image" as const, text: "b" },
        { format: "carousel" as const, text: "c" },
        { format: "video" as const, text: "d" },
      ],
    };
    expect(formatsScore(baseInputs({ posts })).score).toBe(100);
    const mono = { ...posts, items: posts.items.map((p) => ({ ...p, format: "image" as const })) };
    expect(formatsScore(baseInputs({ posts: mono })).score).toBe(0);
  });

  it("desempenho: só com métricas reais da API; dados informados não contam", () => {
    const manual = baseInputs({
      posts: { source: "manual", collectedAt: NOW, items: [{ format: "image", text: "a" }] },
    });
    expect(performanceScore(manual).score).toBeNull();
    const api = baseInputs({
      profile: { ...baseInputs().profile, followers: { value: 1000, source: "instagram_api", collectedAt: NOW } },
      posts: {
        source: "instagram_api",
        collectedAt: NOW,
        items: [1, 2, 3].map((n) => ({
          id: String(n),
          format: "image" as const,
          caption: "",
          timestamp: null,
          likes: 20,
          comments: 5,
          permalink: null,
        })),
      },
    });
    const r = performanceScore(api);
    expect(r.rate).toBeCloseTo(0.025);
    expect(r.score).toBe(70);
  });

  it("nota geral: média ponderada só do que foi avaliado; pesos configuráveis", () => {
    const w = normalizeWeights({ bio: 0, positioning: 20 });
    expect(w.bio).toBe(0);
    expect(w.positioning).toBe(20);
    expect(w.visual).toBe(12);
    const dims = [
      { key: "positioning" as const, score: 80, status: "ai" as const, rationale: "", evidence: "" },
      { key: "bio" as const, score: 10, status: "ai" as const, rationale: "", evidence: "" },
      { key: "visual" as const, score: null, status: "not_evaluated" as const, rationale: "", evidence: "" },
      { key: "completeness" as const, score: 50, status: "objective" as const, rationale: "", evidence: "" },
    ];
    const r = overallScore(dims, w);
    // bio tem peso 0; visual não avaliado fica fora.
    expect(r.score).toBe(Math.round((80 * 20 + 50 * 6) / 26));
    expect(r.evaluatedWeight).toBe(26);
    expect(overallScore([dims[2]!], w).score).toBeNull();
  });

  it("requisitos: sem visão, capturas não liberam identidade visual", () => {
    const shots = [{ fileId: "f", versionId: "v", kind: "grid" as const, name: "grade.png" }];
    expect(availableRequirements(baseInputs({ screenshots: shots }), false).has("visual")).toBe(false);
    expect(availableRequirements(baseInputs({ screenshots: shots }), true).has("visual")).toBe(true);
    expect(availableRequirements(baseInputs({ screenshots: shots }), true).has("posts")).toBe(true);
  });
});

describe("Radar de Marca — regras do sistema sobre a resposta da IA", () => {
  const opts = {
    bioLimit: 150,
    weights: normalizeWeights({}),
    vision: false,
    visionNote: "o modelo escolhido não lê imagens.",
    demo: false,
  };

  it("descarta notas sem dados, recalcula o objetivo, separa observado de hipótese e remove números inventados", () => {
    const raw = diagnosisResponse.parse(aiReply());
    const { result, recommendations, overall } = applyDiagnosisRules(raw, baseInputs(), opts);
    const dim = (k: string) => result.dimensions.find((d) => d.key === k)!;
    // Sem imagens, sem publicações e sem métricas: notas da IA descartadas.
    expect(dim("visual").status).toBe("not_evaluated");
    expect(dim("visual").rationale).toContain("não lê imagens");
    expect(dim("content").score).toBeNull();
    expect(dim("performance").score).toBeNull();
    expect(dim("performance").status).toBe("not_evaluated");
    expect(dim("bio").score).toBe(65);
    expect(dim("completeness").status).toBe("objective");
    expect(dim("audience").status).toBe("not_evaluated");
    expect(result.guardrails.join(" ")).toMatch(/descartadas/);
    expect(overall.score).not.toBeNull();
    expect(overall.evaluatedWeight).toBeLessThan(100);
    // "Cresceu 45%" não está nos dados.
    expect(result.summary).not.toContain("45%");
    expect(result.summary).toContain("[número sem respaldo na fonte]");
    // Observado sem evidência vira hipótese; com evidência, continua observado.
    expect(result.problems[0]!.basis).toBe("hypothesis");
    expect(result.strengths[0]!.basis).toBe("observed");
    // Visual não avaliado mesmo com itens na resposta.
    expect(result.visual).toEqual({ evaluated: false, note: opts.visionNote, items: [] });
    // Sem publicações: categorias de conteúdo como "não dá para avaliar".
    expect(result.content!.categories.every((c) => c.presence === "unknown")).toBe(true);
    // Destaques não informados: base insuficiente.
    expect(result.highlights!.basis).toBe("insufficient");
    // Bio: 3 versões em ordem, contagem do sistema, número inventado trocado e limite apontado.
    expect(result.bio!.versions.map((v) => v.style)).toEqual(["direct", "strategic", "creative"]);
    const direct = result.bio!.versions[0]!;
    expect(direct.text).toContain("[confirmar]");
    expect(direct.text).not.toContain("5000");
    expect(direct.warnings[0]).toMatch(/confirme com o cliente/);
    expect(result.bio!.versions[1]!.overLimit).toBe(true);
    expect(result.bio!.versions[1]!.chars).toBe(200);
    // Recomendação: campos fora do padrão corrigidos.
    expect(recommendations[0]).toMatchObject({ priority: 3, confidence: "medio", basis: "hypothesis" });
  });

  it("com visão e publicações, avalia identidade visual e conteúdo", () => {
    const shots = [{ fileId: "f", versionId: "v", kind: "grid" as const, name: "grade.png" }];
    const raw = diagnosisResponse.parse(aiReply());
    const { result } = applyDiagnosisRules(raw, baseInputs({ screenshots: shots }), {
      ...opts,
      vision: true,
      visionNote: "",
    });
    expect(result.dimensions.find((d) => d.key === "visual")!.score).toBe(90);
    expect(result.visual!.evaluated).toBe(true);
    expect(result.content!.categories.find((c) => c.key === "education")!.presence).toBe("present");
  });

  it("resposta incompleta não quebra: campos ausentes ficam vazios e não avaliados", () => {
    const raw = diagnosisResponse.parse({
      summary: "ok",
      dimensions: "lixo",
      recommendations: [{ title: "só título" }],
    });
    const { result, recommendations } = applyDiagnosisRules(raw, baseInputs(), opts);
    expect(recommendations).toHaveLength(0);
    expect(result.dimensions.filter((d) => d.status === "ai")).toHaveLength(0);
  });

  it("nicho: concorrentes fora da lista são descartados; sem dados, informação insuficiente", () => {
    const raw = nicheResponse.parse({
      summary: "Nicho competitivo",
      facts: ["Concorrente tem 30 mil seguidores"],
      hypotheses: [],
      opportunities: [],
      competitors: [
        { handle: "@rival", positioning: "Preço baixo", differences: "", basis: "observed" },
        { handle: "inventado", positioning: "?", differences: "", basis: "observed" },
      ],
      recommendations: [],
    });
    const { result } = applyNicheRules(raw, baseInputs({ competitors: [{ handle: "rival", notes: "", bio: "" }] }), {
      demo: false,
    });
    expect(result.niche.competitors.map((c) => c.handle)).toEqual(["rival"]);
    expect(result.niche.competitors[0]!.basis).toBe("insufficient");
    expect(result.niche.facts[0]).not.toContain("30 mil");
    expect(result.guardrails.join(" ")).toMatch(/fora da lista/);
  });
});

describe("Radar de Marca — fluxo com demonstração, integrações e permissões", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let other: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;
  let otherClientId: string;
  let profileId: string;
  let firstDiagnosis: string;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    await resetDb();
    ctx = await createOrgWithOwner("Agência Radar");
    other = await createOrgWithOwner("Agência Vizinha");
    await as(ctx.actor, (s) => setProviderEnabled(s, "demo", true));
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Café Aurora", industry: "Cafeteria" }))).id;
    otherClientId = (await as(ctx.actor, (s) => createClient(s, { name: "Loja Sigilo" }))).id;
    await as(ctx.actor, (s) =>
      updateBrandProfile(s, {
        clientId,
        audience: "Jovens que trabalham no centro",
        positioning: "Café especial acessível",
      }),
    );
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.ANTHROPIC_API_KEY = saved.anthropic;
  });

  it("começa a análise pelo @ ou pelo endereço, ligada a um cliente (critério 1)", async () => {
    const p = await as(ctx.actor, (s) =>
      createRadarProfile(s, { clientId, handle: "https://instagram.com/Cafe.Aurora/" }),
    );
    expect(p.handle).toBe("cafe.aurora");
    profileId = p.id;
    await expect(
      as(ctx.actor, (s) => createRadarProfile(s, { clientId, handle: "@cafe.aurora" })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(as(ctx.actor, (s) => createRadarProfile(s, { clientId, handle: "não é @" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await as(ctx.actor, (s) =>
      createRadarProfile(s, { clientId, handle: "@rival.cafe", kind: "competitor", notes: "Foca em preço" }),
    );
    const list = await as(ctx.actor, (s) => listRadarProfiles(s));
    // Concorrentes não aparecem na visão geral, só dentro do perfil do cliente.
    expect(list.map((r) => r.handle)).toEqual(["cafe.aurora"]);
  });

  it("aceita dados manuais e capturas de tela de Arquivos do mesmo cliente (critério 2)", async () => {
    const shot = await as(ctx.actor, (s) =>
      storeUpload(
        s,
        { buffer: Buffer.from(TINY_PNG, "base64"), originalName: "perfil.png" },
        { clientId, category: "reference" },
      ),
    );
    const foreign = await as(ctx.actor, (s) =>
      storeUpload(
        s,
        { buffer: Buffer.from(TINY_PNG, "base64"), originalName: "outro.png" },
        { clientId: otherClientId, category: "reference" },
      ),
    );
    await expect(
      as(ctx.actor, (s) =>
        saveManualInputs(s, { profileId, screenshots: [{ fileId: foreign.fileId, kind: "profile" }] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const manual = await as(ctx.actor, (s) =>
      saveManualInputs(s, {
        profileId,
        displayName: "Café Aurora",
        bio: "Cafés especiais no centro ☕\nPeça pelo link",
        link: "https://cafe.example",
        followers: 1200,
        highlights: ["Cardápio", "Eventos"],
        posts: [
          { format: "image", text: "Novo blend" },
          { format: "carousel", text: "Como preparar" },
          { format: "video", text: "Bastidores" },
        ],
        screenshots: [{ fileId: shot.fileId, kind: "profile" }],
      }),
    );
    expect(manual.screenshots[0]!.name).toBe("perfil.png");
  });

  it("mostra a fonte e a data de cada dado e o que falta (critério 3)", async () => {
    const inputs = await as(ctx.actor, (s) => buildInputs(s, profileId));
    expect(inputs.profile.bio?.source).toBe("manual");
    expect(inputs.profile.bio?.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(inputs.profile.followers?.source).toBe("manual");
    expect(inputs.sources.map((x) => x.kind)).toEqual(
      expect.arrayContaining(["manual", "screenshot", "client_record"]),
    );
    expect(inputs.missing).toContain("Métricas reais (conecte a conta profissional)");
    expect(inputs.competitors.map((c) => c.handle)).toEqual(["rival.cafe"]);
  });

  it("diagnóstico com demonstração: nada inventado, não avaliado fica fora (critérios 9 e 10)", async () => {
    const r = await runBrandAi(ctx.actor, { profileId, action: "analyze" });
    expect(r.demo).toBe(true);
    expect(r.provider).toBe("demo");
    firstDiagnosis = r.diagnosisId;
    const ws = await as(ctx.actor, (s) => getRadarWorkspace(s, profileId));
    const result = ws.latest!.result as DiagnosisResult;
    expect(ws.latest!.demo).toBe(true);
    expect(ws.latest!.inputs.profile.bio?.source).toBe("manual");
    // O modelo de demonstração não lê imagens: identidade visual não avaliada e dito com clareza.
    const visual = result.dimensions.find((d) => d.key === "visual")!;
    expect(visual.status).toBe("not_evaluated");
    expect(visual.rationale).toContain("demonstração não lê imagens");
    expect(result.dimensions.find((d) => d.key === "performance")!.score).toBeNull();
    expect(result.guardrails.join(" ")).toMatch(/sem métricas reais/);
    expect(result.guardrails.join(" ")).toMatch(/Modo demonstração/);
    // Três tipos de base aparecem separados.
    const bases = new Set([...result.strengths, ...result.problems, ...result.opportunities].map((f) => f.basis));
    expect(bases.has("hypothesis")).toBe(true);
    expect(ws.recommendations.some((x) => x.basis === "insufficient")).toBe(true);
    // A nota usa só o avaliado.
    expect(ws.latest!.overallScore).not.toBeNull();
    expect(ws.latest!.evaluatedWeight!).toBeLessThan(100);
    // Bios: 3 versões dentro do limite.
    expect(ws.bios).toHaveLength(3);
    expect(ws.bios.every((b) => countChars(b.text) <= 150)).toBe(true);
  });

  it("bio: editar, escolher (grava no cadastro, não no Instagram), aprovação e tarefa (critério 4)", async () => {
    const ws = await as(ctx.actor, (s) => getRadarWorkspace(s, profileId));
    const base = ws.bios[0]!;
    const edited = await as(ctx.actor, (s) =>
      saveBioVersion(s, { id: base.id, profileId, text: "Café especial no centro. Peça pelo link 👇" }),
    );
    expect(edited.style).toBe("custom");
    const tooLong = await as(ctx.actor, (s) => saveBioVersion(s, { profileId, text: "x".repeat(160) }));
    expect(tooLong.warnings[0]).toMatch(/limite de 150/);
    await as(ctx.actor, (s) => chooseBioVersion(s, edited.id));
    const after = await as(ctx.actor, (s) => getRadarWorkspace(s, profileId));
    expect(after.profile.plannedBio).toBe("Café especial no centro. Peça pelo link 👇");
    expect(after.bios.filter((b) => b.status === "chosen").map((b) => b.id)).toEqual([edited.id]);
    const sent = await as(ctx.actor, (s) => sendBioForApproval(s, { id: edited.id, stage: "internal" }));
    const [approval] = await withOrg(ctx.actor.orgId, (tx) =>
      tx.select().from(approvals).where(eq(approvals.fileId, sent.fileId)),
    );
    expect(approval?.status).toBe("pending");
    const t = await as(ctx.actor, (s) =>
      bioToTask(s, { id: edited.id, project: { mode: "new", name: "Implementação do Radar de Marca" } }),
    );
    const [task] = await withOrg(ctx.actor.orgId, (tx) => tx.select().from(tasks).where(eq(tasks.id, t.taskId)));
    expect(task?.title).toContain("@cafe.aurora");
  });

  it("destaques geram capa e Stories no editor (formato 2) e tarefa (critério 5)", async () => {
    const cover = await as(ctx.actor, (s) =>
      highlightToDesign(s, { diagnosisId: firstDiagnosis, index: 0, kind: "cover" }),
    );
    const stories = await as(ctx.actor, (s) =>
      highlightToDesign(s, { diagnosisId: firstDiagnosis, index: 0, kind: "stories" }),
    );
    const rows = await withOrg(ctx.actor.orgId, (tx) => tx.select().from(designs));
    const c = rows.find((d) => d.id === cover.designId)!;
    const st = rows.find((d) => d.id === stories.designId)!;
    expect(c.clientId).toBe(clientId);
    expect([c.width, c.height]).toEqual([1080, 1920]);
    const doc = st.document as { schema: string; pages: unknown[] };
    expect(doc.schema).toBe("aragonez.design/2");
    expect(doc.pages.length).toBe(3);
    const t = await as(ctx.actor, (s) =>
      highlightToTask(s, { diagnosisId: firstDiagnosis, index: 1, project: { mode: "new", name: "Destaques" } }),
    );
    expect(t.taskId).toBeTruthy();
  });

  it("recomendações viram tarefa, arte, carrossel e conteúdo (critério 6)", async () => {
    const ws = await as(ctx.actor, (s) => getRadarWorkspace(s, profileId));
    const rec = ws.recommendations[0]!;
    const t1 = await as(ctx.actor, (s) =>
      recommendationToTask(s, { id: rec.id, project: { mode: "new", name: "Plano do Radar" } }),
    );
    const t2 = await as(ctx.actor, (s) =>
      recommendationToTask(s, { id: rec.id, project: { mode: "existing", id: t1.projectId } }),
    );
    // Não duplica a tarefa.
    expect(t2).toMatchObject({ taskId: t1.taskId, existed: true });
    const d = await as(ctx.actor, (s) => recommendationToDesign(s, { id: rec.id, format: "carousel" }));
    const [design] = await withOrg(ctx.actor.orgId, (tx) =>
      tx.select().from(designs).where(eq(designs.id, d.designId)),
    );
    expect((design!.document as { meta?: { carousel?: boolean } }).meta?.carousel).toBe(true);
    const content = await as(ctx.actor, (s) =>
      recommendationToContent(s, {
        id: rec.id,
        format: "carousel",
        campaign: { mode: "new", name: "Campanha do Radar" },
      }),
    );
    const [item] = await withOrg(ctx.actor.orgId, (tx) =>
      tx.select().from(contentItems).where(eq(contentItems.id, content.contentItemId)),
    );
    expect(item?.campaignId).toBe(content.campaignId);
    const [stored] = await withOrg(ctx.actor.orgId, (tx) =>
      tx.select().from(brandRadarRecommendations).where(eq(brandRadarRecommendations.id, rec.id)),
    );
    expect(stored).toMatchObject({
      taskId: t1.taskId,
      designId: d.designId,
      contentItemId: content.contentItemId,
      status: "in_progress",
    });
    await as(ctx.actor, (s) => updateRecommendation(s, { id: rec.id, status: "done", dueDate: "2026-11-01" }));
    const idea = await as(ctx.actor, (s) => contentIdeaToContent(s, { diagnosisId: firstDiagnosis, index: 0 }));
    expect(idea.contentItemId).toBeTruthy();
  });

  it("diagnósticos ficam salvos e podem ser comparados; mudança de pesos é avisada (critério 7)", async () => {
    await as(ctx.actor, (s) => updateRadarSettings(s, { bioLimit: 150, weights: { bio: 30 } }));
    const second = await runBrandAi(ctx.actor, { profileId, action: "reassess" });
    const cmp = await as(ctx.actor, (s) => compareDiagnoses(s, firstDiagnosis, second.diagnosisId));
    expect(cmp.before.id).toBe(firstDiagnosis);
    expect(cmp.methodologyChanged).toBe(true);
    expect(cmp.recommendations.done).toBe(1);
    expect(cmp.dimensions.find((x) => x.key === "visual")!.delta).toBeNull();
    // Seguidores informados manualmente não entram como métrica comparável.
    expect(cmp.followers.before).toBeNull();
    const niche = await runBrandAi(ctx.actor, { profileId, action: "competitors" });
    expect(niche.kind).toBe("niche");
    const bio = await runBrandAi(ctx.actor, { profileId, action: "bio" });
    expect(bio.bios).toBe(3);
    const ws = await as(ctx.actor, (s) => getRadarWorkspace(s, profileId));
    expect(ws.diagnoses.map((x) => x.kind)).toEqual(["bio", "niche", "full", "full"]);
    expect(ws.latestNiche).not.toBeNull();
    await expect(
      as(ctx.actor, (s) =>
        updateRadarSettings(s, {
          bioLimit: 150,
          weights: Object.fromEntries(
            [
              "positioning",
              "bio",
              "completeness",
              "visual",
              "highlights",
              "content",
              "cta",
              "audience",
              "formats",
              "consistency",
              "performance",
            ].map((k) => [k, 0]),
          ),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("respeita as permissões e o escopo de clientes (critério 8)", async () => {
    // Designer (vê todos os clientes): consulta o Radar, mas não roda análises nem cadastra perfis.
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Designer" });
    expect((await as(designer, (s) => getRadarWorkspace(s, profileId))).profile.handle).toBe("cafe.aurora");
    await expect(runBrandAi(designer, { profileId, action: "analyze" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(designer, (s) => createRadarProfile(s, { clientId, handle: "@novo" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Papel só com os clientes atribuídos (sem "todos os clientes"), com acesso ao Radar.
    const [collab] = await withOrg(ctx.actor.orgId, (tx) =>
      tx.select().from(roles).where(eq(roles.key, "collaborator")),
    );
    await as(ctx.actor, (s) =>
      saveRole(s, {
        id: collab!.id,
        name: collab!.name,
        kind: "internal",
        permissions: [...collab!.permissions, "brand.read", "brand.manage", "ai.use"],
      }),
    );
    const restricted = await addMember(ctx.org.slug, ctx.org.id, "collaborator", { name: "Restrito" });
    await expect(as(restricted, (s) => getRadarWorkspace(s, profileId))).rejects.toBeInstanceOf(NotFoundError);
    expect(await as(restricted, (s) => listRadarProfiles(s))).toHaveLength(0);
    await expect(as(restricted, (s) => createRadarProfile(s, { clientId, handle: "@outro.perfil" }))).rejects.toThrow();
    await expect(runBrandAi(restricted, { profileId, action: "analyze" })).rejects.toBeInstanceOf(NotFoundError);
    await as(ctx.actor, (s) =>
      setClientMembers(s, { clientId, members: [{ membershipId: restricted.membershipId, role: "member" }] }),
    );
    expect((await as(restricted, (s) => listRadarProfiles(s))).map((r) => r.handle)).toEqual(["cafe.aurora"]);
    // Continua sem ver o outro cliente.
    await expect(
      as(restricted, (s) => createRadarProfile(s, { clientId: otherClientId, handle: "@sigilo" })),
    ).rejects.toThrow();
    // Outra organização: isolamento por RLS.
    await expect(as(other.actor, (s) => getRadarWorkspace(s, profileId))).rejects.toBeInstanceOf(NotFoundError);
    expect(await as(other.actor, (s) => listRadarProfiles(s))).toHaveLength(0);
    // Usuário do portal do cliente não acessa o Radar.
    const portal = await addMember(ctx.org.slug, ctx.org.id, "client", { name: "Cliente", clientIds: [clientId] });
    await expect(as(portal, (s) => listRadarProfiles(s))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Radar de Marca — provedor real simulado (com imagens) e política de dados", () => {
  const KEY = "sk-ant-teste-radar-marca1";
  let mock: ReturnType<typeof installAiMock>;
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let profileId: string;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add(KEY);
    await resetDb();
    ctx = await createOrgWithOwner("Agência Visão");
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "anthropic", KEY))).ok).toBe(true);
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Padaria Sol" }))).id;
    profileId = (
      await as(ctx.actor, (s) =>
        createRadarProfile(s, { clientId, handle: "@padaria.sol", niche: "Padaria artesanal" }),
      )
    ).id;
    const shot = await as(ctx.actor, (s) =>
      storeUpload(
        s,
        { buffer: Buffer.from(TINY_PNG, "base64"), originalName: "grade.png" },
        { clientId, category: "reference" },
      ),
    );
    await as(ctx.actor, (s) =>
      saveManualInputs(s, {
        profileId,
        bio: "Pães de fermentação natural. Encomende pelo link",
        screenshots: [{ fileId: shot.fileId, kind: "grid" }],
      }),
    );
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("sem autorização para dados de clientes, não envia nada à IA", async () => {
    await as(ctx.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    await expect(runBrandAi(ctx.actor, { profileId, action: "analyze" })).rejects.toBeInstanceOf(BrandAiError);
    expect(mock.calls.filter((c) => c.url.includes("/v1/messages"))).toHaveLength(0);
  });

  it("com modelo de visão, envia as capturas e avalia a identidade visual", async () => {
    await as(ctx.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: true, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    mock.state.reply = JSON.stringify(aiReply());
    const r = await runBrandAi(ctx.actor, { profileId, action: "analyze" });
    expect(r.provider).toBe("anthropic");
    expect(r.demo).toBe(false);
    const call = mock.calls.find((c) => c.url.includes("/v1/messages"))!;
    const content = (call.body!.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content[0]!.type).toBe("image");
    expect(content.at(-1)!.type).toBe("text");
    const ws = await as(ctx.actor, (s) => getRadarWorkspace(s, profileId));
    const result = ws.latest!.result as DiagnosisResult;
    expect(result.visual!.evaluated).toBe(true);
    expect(result.dimensions.find((d) => d.key === "visual")!.score).toBe(90);
    // Grade de publicações vista na imagem libera a avaliação de conteúdo; desempenho continua fora.
    expect(result.dimensions.find((d) => d.key === "performance")!.score).toBeNull();
  });

  it("sem enviar as capturas, diz que não dá para avaliar a identidade visual", async () => {
    mock.state.reply = JSON.stringify(aiReply());
    await runBrandAi(ctx.actor, { profileId, action: "analyze", useImages: false });
    const call = mock.calls.find((c) => c.url.includes("/v1/messages"))!;
    const content = (call.body!.messages as { content: unknown }[])[0]!.content;
    expect(typeof content === "string" || (content as { type: string }[]).every((b) => b.type === "text")).toBe(true);
    const ws = await as(ctx.actor, (s) => getRadarWorkspace(s, profileId));
    const result = ws.latest!.result as DiagnosisResult;
    expect(result.visual!.evaluated).toBe(false);
    expect(result.visual!.note).toMatch(/desmarcado/);
  });

  it("falha do provedor é registrada e não vira diagnóstico", async () => {
    mock.state.failStatus = 500;
    const before = (await as(ctx.actor, (s) => getRadarWorkspace(s, profileId))).diagnoses.length;
    await expect(runBrandAi(ctx.actor, { profileId, action: "analyze" })).rejects.toBeInstanceOf(BrandAiError);
    expect((await as(ctx.actor, (s) => getRadarWorkspace(s, profileId))).diagnoses.length).toBe(before);
    mock.state.failStatus = null;
  });
});

describe("Radar de Marca — conexão oficial com o Instagram (API da Meta simulada)", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let profileId: string;
  const saved = { id: env.META_APP_ID, secret: env.META_APP_SECRET };
  const calls: string[] = [];
  let mode: { username: string; tokenStatus: number; format: "data" | "flat" } = {
    username: "cafe.norte",
    tokenStatus: 200,
    format: "data",
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  function stubMeta() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
        if (url.host === "api.instagram.com" && url.pathname === "/oauth/access_token") {
          const body = new URLSearchParams(String(init?.body));
          if (body.get("code") !== "codigo-bom")
            return json({ error_type: "OAuthException", code: 400, error_message: "Invalid code" }, 400);
          const item = { access_token: "curto-123", user_id: 17841400000000, permissions: "instagram_business_basic" };
          return json(mode.format === "data" ? { data: [item] } : item);
        }
        if (url.host === "graph.instagram.com" && url.pathname === "/access_token") {
          expect(url.searchParams.get("grant_type")).toBe("ig_exchange_token");
          return json({ access_token: "longo-456", token_type: "bearer", expires_in: 5_184_000 });
        }
        if (url.host === "graph.instagram.com" && url.pathname === "/refresh_access_token") {
          return json({ access_token: "renovado-789", token_type: "bearer", expires_in: 5_184_000 });
        }
        if (url.host === "graph.instagram.com" && url.pathname.endsWith("/me")) {
          if (mode.tokenStatus !== 200)
            return json(
              { error: { message: "Error validating access token", type: "OAuthException", code: 190 } },
              400,
            );
          if (url.searchParams.get("fields") === "biography,website") {
            return json(
              {
                error: { message: "Tried accessing nonexisting field (biography)", type: "OAuthException", code: 100 },
              },
              400,
            );
          }
          return json({
            user_id: "17841400000000",
            username: mode.username,
            name: "Café Norte",
            account_type: "BUSINESS",
            followers_count: 2000,
            follows_count: 150,
            media_count: 3,
          });
        }
        if (url.host === "graph.instagram.com" && url.pathname.endsWith("/me/media")) {
          return json({
            data: [
              {
                id: "1",
                caption: "Novo blend",
                media_type: "IMAGE",
                media_product_type: "FEED",
                timestamp: "2026-10-01T10:00:00+0000",
                like_count: 50,
                comments_count: 4,
              },
              {
                id: "2",
                caption: "Como preparar",
                media_type: "CAROUSEL_ALBUM",
                media_product_type: "FEED",
                timestamp: "2026-10-05T10:00:00+0000",
                like_count: 70,
                comments_count: 6,
              },
              {
                id: "3",
                caption: "Bastidores",
                media_type: "VIDEO",
                media_product_type: "REELS",
                timestamp: "2026-10-09T10:00:00+0000",
                comments_count: 2,
              },
              { id: "4", media_type: "IMAGE", media_product_type: "STORY" },
            ],
          });
        }
        return json({ error: { message: "não simulado" } }, 404);
      }),
    );
  }

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Conectada");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Café Norte" }))).id;
    profileId = (await as(ctx.actor, (s) => createRadarProfile(s, { clientId, handle: "@cafe.norte" }))).id;
  });

  afterAll(() => {
    env.META_APP_ID = saved.id;
    env.META_APP_SECRET = saved.secret;
    vi.unstubAllGlobals();
  });

  it("sem configuração no servidor, mostra 'não configurado' e não tenta conectar", async () => {
    env.META_APP_ID = undefined;
    env.META_APP_SECRET = undefined;
    expect((await as(ctx.actor, (s) => instagramState(s, profileId))).status).toBe("not_configured");
    await expect(as(ctx.actor, (s) => instagramConnectUrl(s, profileId, ctx.org.slug))).rejects.toBeInstanceOf(
      InstagramError,
    );
  });

  it("estado assinado: recusa adulteração, outro usuário e pedido vencido", () => {
    const st = signState({ org: "x", profileId: "p", userId: "u1" });
    expect(verifyState(st, "u1")?.profileId).toBe("p");
    expect(verifyState(st, "u2")).toBeNull();
    expect(
      verifyState(
        st.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
        "u1",
      ),
    ).toBeNull();
    expect(verifyState(st, "u1", Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it("monta o endereço oficial de autorização (sem senha, só a permissão básica)", async () => {
    env.META_APP_ID = "123456";
    env.META_APP_SECRET = "segredo-do-app";
    const url = new URL(await as(ctx.actor, (s) => instagramConnectUrl(s, profileId, ctx.org.slug)));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("123456");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/brand-radar\/instagram\/callback$/);
    expect(verifyState(url.searchParams.get("state")!, ctx.actor.userId)?.profileId).toBe(profileId);
  });

  it("troca o código pelo token de longa duração nos dois formatos de resposta e lê as publicações", async () => {
    stubMeta();
    const t = await exchangeCode("codigo-bom");
    expect(t).toMatchObject({
      accessToken: "longo-456",
      userId: "17841400000000",
      scopes: ["instagram_business_basic"],
    });
    mode = { ...mode, format: "flat" };
    expect((await exchangeCode("codigo-bom")).accessToken).toBe("longo-456");
    await expect(exchangeCode("codigo-ruim")).rejects.toBeInstanceOf(InstagramError);
    const media = await fetchMedia("longo-456", "v23.0");
    expect(media.map((m) => m.format)).toEqual(["image", "carousel", "video"]);
    // Curtidas que a API não devolve ficam nulas, nunca zero.
    expect(media[2]!.likes).toBeNull();
  });

  it("recusa a conexão de outra conta e guarda o token criptografado da conta certa", async () => {
    stubMeta();
    mode = { username: "outra.conta", tokenStatus: 200, format: "data" };
    await expect(completeInstagramConnection(ctx.actor, { profileId, code: "codigo-bom" })).rejects.toThrow(
      /não é a do perfil/,
    );
    mode = { ...mode, username: "Cafe.Norte" };
    await completeInstagramConnection(ctx.actor, { profileId, code: "codigo-bom" });
    const [conn] = await withOrg(ctx.actor.orgId, (tx) => tx.select().from(brandRadarConnections));
    expect(conn!.status).toBe("connected");
    expect(conn!.accessTokenEnc).not.toContain("longo-456");
    expect(conn!.accessTokenEnc).toMatch(/^v1\./);
    expect(conn!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    // As métricas passam a vir da API, com a data da coleta.
    const inputs = await as(ctx.actor, (s) => buildInputs(s, profileId));
    expect(inputs.profile.followers).toMatchObject({ value: 2000, source: "instagram_api" });
    expect(inputs.posts?.source).toBe("instagram_api");
    expect(inputs.profile.bio).toBeNull();
    expect(performanceScore(inputs).score).not.toBeNull();
    const state = await as(ctx.actor, (s) => instagramState(s, profileId));
    expect(state).toMatchObject({ configured: true, status: "connected", username: "Cafe.Norte" });
  });

  it("token vencido ou revogado: marca a conexão e pede para conectar de novo", async () => {
    stubMeta();
    mode = { ...mode, tokenStatus: 400 };
    await expect(syncInstagram(ctx.actor, profileId)).rejects.toBeInstanceOf(TokenInvalidError);
    const [conn] = await withOrg(ctx.actor.orgId, (tx) => tx.select().from(brandRadarConnections));
    expect(conn!.status).toBe("expired");
    // Data de validade no passado também conta como vencida.
    await withOrg(ctx.actor.orgId, (tx) =>
      tx.update(brandRadarConnections).set({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    );
    expect((await as(ctx.actor, (s) => instagramState(s, profileId))).status).toBe("expired");
    await expect(syncInstagram(ctx.actor, profileId)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it("renova o token perto do vencimento e desconecta apagando o token", async () => {
    stubMeta();
    mode = { ...mode, tokenStatus: 200 };
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    await withOrg(ctx.actor.orgId, (tx) =>
      tx
        .update(brandRadarConnections)
        .set({ tokenExpiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000), updatedAt: old }),
    );
    calls.length = 0;
    const r = await syncInstagram(ctx.actor, profileId);
    expect(r.posts).toBe(3);
    expect(calls).toContain("GET graph.instagram.com/refresh_access_token");
    const [conn] = await withOrg(ctx.actor.orgId, (tx) => tx.select().from(brandRadarConnections));
    expect(conn!.status).toBe("connected");
    expect(conn!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30 * 24 * 3600 * 1000);
    expect((await as(ctx.actor, (s) => disconnectInstagram(s, profileId))).removed).toBe(true);
    expect(await withOrg(ctx.actor.orgId, (tx) => tx.select().from(brandRadarConnections))).toHaveLength(0);
    expect((await as(ctx.actor, (s) => instagramState(s, profileId))).status).toBe("disconnected");
  });

  it("dados manuais vazios continuam válidos depois de desconectar", async () => {
    const inputs = await as(ctx.actor, (s) => buildInputs(s, profileId));
    expect(inputs.profile.followers).toBeNull();
    expect(EMPTY_MANUAL.posts).toEqual([]);
    const rows = await withOrg(ctx.actor.orgId, (tx) => tx.select().from(brandRadarBioVersions));
    expect(rows).toHaveLength(0);
  });
});
