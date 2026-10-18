import { and, desc, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseDesignDocument,
  readDesignDocument,
  type DesignDocument,
  type GeneratorMeta,
  type TextObject,
} from "@/lib/design-doc";
import { withOrg } from "@/server/db";
import { aiUsage, designVersions, files, fileVersions } from "@/server/db/schema";
import { env } from "@/server/env";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { CostConfirmationError, updateAiSettings } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { saveProviderKey } from "@/server/services/ai-providers";
import {
  createCarouselVariant,
  generateCarousel,
  prepareCarousel,
  regenerateCarouselSlide,
  restyleCarousel,
  type CarouselEvent,
} from "@/server/services/carousel-generator";
import { createClient, updateBrandProfile } from "@/server/services/clients";
import { importImageAsTemplate } from "@/server/services/design-import";
import { getDesign, saveDesign } from "@/server/services/designs";
import { setClientLogo, storeUpload } from "@/server/services/files";
import { installAiMock, TINY_PNG } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Gerador de carrosséis e importação de JPG/PNG como modelo, pelo serviço:
 * provedor de demonstração (local) e provedores reais simulados (Anthropic
 * para texto e leitura de imagens, OpenAI para imagens). Cobre progresso,
 * persistência, identidade do cliente, privacidade, custo, falhas, regenerar
 * um slide, nova direção visual, segunda versão e permissões.
 */

const policy = { enabled: true, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };

async function doc(actor: Parameters<typeof as>[0], id: string) {
  const d = (await as(actor, (s) => getDesign(s, id))).design;
  return { design: d, doc: readDesignDocument(d.document, d).doc as DesignDocument };
}
const gen = (d: DesignDocument) => d.meta!.generator as GeneratorMeta;
const steps = (events: CarouselEvent[]) =>
  events.filter((e): e is Extract<CarouselEvent, { t: "step" }> => e.t === "step").map((e) => `${e.step}:${e.status}`);

describe("gerador de carrosséis (demonstração)", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;
  let logoVersion: string;
  const savedProvider = env.AI_DEFAULT_PROVIDER;

  beforeAll(async () => {
    // Provedor de demonstração habilitado (como no desenvolvimento local), em qualquer modo de banco.
    env.AI_DEFAULT_PROVIDER = "demo";
    await resetDb();
    ctx = await createOrgWithOwner("Agência Carrossel");
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: true }));
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Clínica Sorriso" }))).id;
    await as(ctx.actor, (s) =>
      updateBrandProfile(s, {
        clientId,
        toneOfVoice: "Acolhedor e técnico",
        colors: [
          { name: "Principal", hex: "#0B6E4F" },
          { name: "Destaque", hex: "#F2C14E" },
        ],
        fonts: [{ name: "Poppins" }],
      }),
    );
    const logo = await as(ctx.actor, (s) =>
      storeUpload(
        s,
        { buffer: Buffer.from(TINY_PNG, "base64"), originalName: "logo-sorriso.png" },
        { clientId, category: "brand_logo" },
      ),
    );
    await as(ctx.actor, (s) => setClientLogo(s, clientId, logo.fileId));
    logoVersion = logo.versionId;
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = savedProvider;
  });

  it("modo rápido: progresso real em 5 etapas, salva no formato do editor e marca demonstração", async () => {
    const r = await generateCarousel(ctx.actor, { topic: "Como montar uma reserva de emergência" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(steps(r.events)).toEqual([
      "plan:running",
      "plan:done",
      "script:running",
      "script:done",
      "visuals:running",
      "visuals:done",
      "assemble:running",
      "assemble:done",
      "save:running",
      "save:done",
    ]);
    const done = r.events.find((e) => e.t === "done")!;
    expect(done).toMatchObject({ designId: r.designId, demo: true, visuals: "vector" });
    // Sem modelo de imagem: só vetores, com aviso (nunca imagem simulada).
    expect((done as { warnings: string[] }).warnings.join(" ")).toMatch(/Nenhum modelo de geração de imagens/);
    const { design, doc: d } = await doc(ctx.actor, r.designId);
    expect(() => parseDesignDocument(d)).not.toThrow();
    expect(d.meta?.carousel).toBe(true);
    expect(design.width).toBe(1080);
    expect(design.height).toBe(1350);
    const meta = gen(d);
    expect(meta.ai.demo).toBe(true);
    expect(meta.slides.map((s) => s.pageId)).toEqual(d.pages.map((p) => p.id));
    expect(d.pages.flatMap((p) => p.objects).some((o) => o.type === "image")).toBe(false);
    // Uso registrado como sucesso.
    const usage = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiUsage).where(eq(aiUsage.operation, "carousel_plan")).orderBy(desc(aiUsage.createdAt)).limit(1),
    );
    expect(usage[0]).toMatchObject({ status: "success", provider: "demo", module: "carousel" });
  });

  it("três temas de segmentos diferentes geram carrosséis diferentes", async () => {
    const topics = ["Clareamento dental: mitos e cuidados", "Café especial em casa", "Treino de força para iniciantes"];
    const sigs = [];
    for (const topic of topics) {
      const r = await generateCarousel(ctx.actor, { topic, mode: "full", objective: "Educar e gerar salvamentos" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const meta = gen((await doc(ctx.actor, r.designId)).doc);
      sigs.push(JSON.stringify([meta.direction.key, meta.direction.motif, meta.slides.map((s) => s.layout)]));
      expect(meta.input.objective).toBe("Educar e gerar salvamentos");
    }
    expect(new Set(sigs).size).toBe(3);
  });

  it("identidade do cliente: cores e fonte da marca e logo do cliente nos slides", async () => {
    const r = await generateCarousel(ctx.actor, {
      topic: "Clareamento dental: mitos e cuidados",
      clientId,
      mode: "full",
      slides: 6,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { design, doc: d } = await doc(ctx.actor, r.designId);
    expect(design.clientId).toBe(clientId);
    expect(d.pages).toHaveLength(6);
    const meta = gen(d);
    expect(meta.direction.fromIdentity).toBe(true);
    expect(meta.direction.fonts.heading).toBe("Poppins");
    expect(meta.direction.logo?.versionId).toBe(logoVersion);
    const logos = d.pages.flatMap((p) => p.objects).filter((o) => o.type === "image");
    expect(logos.length).toBeGreaterThan(0);
    expect(logos.every((o) => o.type === "image" && o.src === `/api/files/${logoVersion}`)).toBe(true);
  });

  it("regenera um slide: só a página dele muda, com versão 'Antes de…' e controle de revisão", async () => {
    const r = await generateCarousel(ctx.actor, { topic: "Organização financeira para autônomos" });
    if (!r.ok) throw new Error(r.message);
    const before = await doc(ctx.actor, r.designId);
    const target = before.doc.pages[2]!;
    const res = await regenerateCarouselSlide(ctx.actor, {
      designId: r.designId,
      revision: before.design.revision,
      pageId: target.id,
      instruction: "mais curto",
    });
    expect(res.revision).toBe(before.design.revision + 1);
    expect(res.ops.map((o) => o.op)).toEqual(["replacePage", "replaceMeta"]);
    const after = await doc(ctx.actor, r.designId);
    expect(after.doc.pages.map((p) => p.id)).toEqual(before.doc.pages.map((p) => p.id));
    before.doc.pages.forEach((p, i) => {
      if (i === 2) expect(JSON.stringify(after.doc.pages[i])).not.toBe(JSON.stringify(p));
      else expect(after.doc.pages[i]).toEqual(p);
    });
    expect(gen(after.doc).version).toBe(2);
    expect(gen(after.doc).history.at(-1)).toMatchObject({ action: "slide", slideKey: gen(before.doc).slides[2]!.key });
    const versions = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(designVersions)
        .where(and(eq(designVersions.designId, r.designId), eq(designVersions.kind, "named"))),
    );
    expect(versions.map((v) => v.label)).toContain("Antes de regenerar o slide 3");
    // Revisão desatualizada: nada é aplicado.
    await expect(
      regenerateCarouselSlide(ctx.actor, { designId: r.designId, revision: before.design.revision, pageId: target.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("nova direção visual mantém os textos editados e grava versão anterior", async () => {
    const r = await generateCarousel(ctx.actor, { topic: "Café especial em casa" });
    if (!r.ok) throw new Error(r.message);
    const cur = await doc(ctx.actor, r.designId);
    const meta = gen(cur.doc);
    // A equipe edita o título do slide 2 no editor (salvamento normal).
    const edited = structuredClone(cur.doc);
    const title = edited.pages[1]!.objects.find((o) => o.id === `${meta.slides[1]!.key}-title`) as TextObject;
    title.text = "Título reescrito pela equipe";
    const saved = await as(ctx.actor, (s) =>
      saveDesign(s, {
        id: r.designId,
        revision: cur.design.revision,
        document: edited as unknown as Record<string, unknown>,
      }),
    );
    const res = await as(ctx.actor, (s) => restyleCarousel(s, { designId: r.designId, revision: saved.revision }));
    const after = await doc(ctx.actor, r.designId);
    const m2 = gen(after.doc);
    expect(m2.direction.key).not.toBe(meta.direction.key);
    expect(res.direction).toBe(m2.direction.name);
    const t2 = after.doc.pages[1]!.objects.find((o) => o.id === `${meta.slides[1]!.key}-title`) as TextObject;
    expect(t2.text.toLowerCase()).toBe("título reescrito pela equipe");
    const versions = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(designVersions)
        .where(and(eq(designVersions.designId, r.designId), eq(designVersions.kind, "named"))),
    );
    expect(versions.map((v) => v.label)).toContain("Antes de trocar a direção visual");
  });

  it("segunda versão: arte nova com outra composição; a original não muda", async () => {
    const r = await generateCarousel(ctx.actor, { topic: "Treino de força para iniciantes" });
    if (!r.ok) throw new Error(r.message);
    const orig = await doc(ctx.actor, r.designId);
    const v = await as(ctx.actor, (s) => createCarouselVariant(s, { designId: r.designId }));
    const copy = await doc(ctx.actor, v.id);
    const m1 = gen(orig.doc);
    const m2 = gen(copy.doc);
    expect(m2.variantOf).toBe(r.designId);
    expect(m2.slides.map((s) => s.title)).toEqual(m1.slides.map((s) => s.title));
    const changed = m2.slides.filter((s, i) => s.layout !== m1.slides[i]!.layout).length;
    expect(changed).toBeGreaterThanOrEqual(Math.ceil(m1.slides.length / 2));
    expect(m2.direction.motif).not.toBe(m1.direction.motif);
    expect((await doc(ctx.actor, r.designId)).design.revision).toBe(orig.design.revision);
  });

  it("permissões: sem 'editar artes' não gera; cliente de outra agência não é acessível", async () => {
    const account = await addMember(ctx.org.slug, ctx.org.id, "account");
    await expect(as(account, (s) => prepareCarousel(s, { topic: "Teste de permissão" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const other = await createOrgWithOwner("Outra agência");
    await expect(generateCarousel(other.actor, { topic: "Cliente alheio", clientId })).rejects.toThrow();
    await expect(as(ctx.actor, (s) => prepareCarousel(s, { topic: "x" }))).rejects.toThrow();
  });

  it("importar PNG como modelo sem modelo de leitura de imagens: só a camada de fundo", async () => {
    const png = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#224466" } })
      .png()
      .toBuffer();
    const res = await importImageAsTemplate(
      ctx.actor,
      { buffer: png, originalName: "post-referencia.png" },
      { clientId, reconstruct: true },
    );
    expect(res.reconstructed).toBe(false);
    expect(res.message).toMatch(/só a camada de fundo/);
    const { design, doc: d } = await doc(ctx.actor, res.id);
    expect(design.isTemplate).toBe(true);
    expect(design.clientId).toBe(clientId);
    expect([design.width, design.height]).toEqual([1080, 1350]);
    const [bg] = d.pages[0]!.objects;
    expect(bg).toMatchObject({ type: "image", locked: true, x: 0, y: 0, width: 1080, height: 1350 });
    expect(bg!.hidden).toBeFalsy();
    expect(d.meta?.imported).toMatchObject({ fileId: res.fileId, reconstructed: false });
    const [f] = await withOrg(ctx.org.id, (tx) => tx.select().from(files).where(eq(files.id, res.fileId)));
    expect(f).toMatchObject({ clientId, category: "reference" });
    await expect(
      importImageAsTemplate(ctx.actor, { buffer: Buffer.from("não é imagem"), originalName: "x.png" }, {}),
    ).rejects.toBeInstanceOf(ValidationError);
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(
      importImageAsTemplate(designer, { buffer: png, originalName: "a.png" }, { asTemplate: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Como arte comum, o designer pode importar.
    const asArt = await importImageAsTemplate(designer, { buffer: png, originalName: "a.png" }, { asTemplate: false });
    expect((await doc(designer, asArt.id)).design.isTemplate).toBe(false);
  });
});

const ANTHROPIC = "sk-ant-teste-valida-carr1";
const OPENAI = "sk-openai-teste-valida-carr1";
const TEXT = { mode: "manual" as const, provider: "anthropic", model: "claude-sonnet-5-5" };

const PLAN = {
  title: "Energia solar em casa",
  angle: "Mostrar que dá para começar com planejamento.",
  objective: "Educar",
  audience: "Donos de casa",
  narrative: "Gancho → dúvida → passos → chamada",
  caption: "Legenda de teste.",
  hashtags: ["energia", "#solar"],
  cta: "Peça um orçamento",
  slides: [
    {
      role: "cover",
      kicker: "Guia",
      title: "Energia solar em casa",
      body: "Comece do jeito certo",
      bullets: [],
      columns: [],
      stat: { value: "", label: "", source: "" },
      chart: { unit: "", source: "", items: [] },
      visual: { kind: "image", prompt: "Telhado com painéis solares ao entardecer", icon: "" },
    },
    {
      role: "problem",
      kicker: "A dúvida",
      title: "Vale a pena para a minha casa?",
      body: "Depende do consumo e do telhado.",
      bullets: [],
      columns: [],
      stat: { value: "", label: "", source: "" },
      chart: { unit: "", source: "", items: [] },
      visual: { kind: "image", prompt: "Conta de luz sobre a mesa", icon: "" },
    },
    {
      role: "data",
      kicker: "",
      title: "O que diz a pesquisa",
      body: "",
      bullets: [],
      columns: [],
      stat: { value: "72%", label: "querem reduzir a conta", source: "" },
      chart: { unit: "", source: "", items: [] },
      visual: { kind: "typographic", prompt: "", icon: "" },
    },
    {
      role: "steps",
      kicker: "Passo a passo",
      title: "Como começar",
      body: "",
      bullets: ["Veja seu consumo", "Peça uma visita técnica", "Compare propostas"],
      columns: [],
      stat: { value: "", label: "", source: "" },
      chart: { unit: "", source: "", items: [] },
      visual: { kind: "diagram", prompt: "", icon: "" },
    },
    {
      role: "cta",
      kicker: "",
      title: "Quer economizar?",
      body: "Fale com a gente.",
      bullets: [],
      columns: [],
      stat: { value: "", label: "", source: "" },
      chart: { unit: "", source: "", items: [] },
      visual: { kind: "icon", prompt: "", icon: "sun" },
    },
  ],
  claims: [{ text: "72% querem reduzir a conta", slide: 3, reason: "Pesquisa citada pela equipe" }],
  direction: { style: "bold", mood: "", palette: [] },
};

describe("gerador de carrosséis (provedores reais simulados)", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;
  let mock: ReturnType<typeof installAiMock>;
  const saved = { demo: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    env.OPENAI_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add(ANTHROPIC);
    mock.state.valid.openai.add(OPENAI);
    await resetDb();
    ctx = await createOrgWithOwner("Agência Solar");
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "anthropic", ANTHROPIC))).ok).toBe(true);
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "openai", OPENAI))).ok).toBe(true);
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: false }));
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Solar Lar" }))).id;
    await as(ctx.actor, (s) =>
      updateBrandProfile(s, {
        clientId,
        toneOfVoice: "Tom secreto da marca",
        colors: [{ name: "Laranja", hex: "#E8590C" }],
      }),
    );
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.demo;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    env.OPENAI_API_KEY = saved.openai;
    vi.unstubAllGlobals();
  });

  it("gera imagens reais (OpenAI) salvas nos Arquivos do cliente e as usa nos slides; números só das referências", async () => {
    mock.reset();
    mock.state.reply = JSON.stringify(PLAN);
    const r = await generateCarousel(ctx.actor, {
      topic: "Energia solar em casa",
      clientId,
      mode: "full",
      references: "Pesquisa Exemplo: 72% dos moradores querem reduzir a conta de luz.",
      selection: TEXT,
    });
    if (!r.ok) throw new Error(r.message);
    const imageCalls = mock.generationCalls().filter((c) => c.url.includes("/v1/images/generations"));
    expect(imageCalls).toHaveLength(2);
    expect(String(imageCalls[0]!.body?.prompt)).toContain("Telhado com painéis solares");
    const { doc: d } = await doc(ctx.actor, r.designId);
    const meta = gen(d);
    expect(meta.visuals).toBe("images");
    expect(meta.ai).toMatchObject({ provider: "anthropic", imageProvider: "openai", demo: false });
    const imgs = d.pages.flatMap((p) => p.objects).filter((o) => o.type === "image");
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    const versionIds = imgs.map((o) => (o.type === "image" ? o.src.replace("/api/files/", "") : ""));
    const rows = await withOrg(ctx.org.id, (tx) =>
      tx
        .select({ clientId: files.clientId, source: fileVersions.source, id: fileVersions.id })
        .from(fileVersions)
        .innerJoin(files, eq(files.id, fileVersions.fileId)),
    );
    for (const v of versionIds) expect(rows.find((x) => x.id === v)).toMatchObject({ clientId, source: "ai" });
    // 72% veio das referências: entra, marcado como dado a confirmar.
    expect(meta.slides.find((s) => s.role === "data")?.stat?.value).toBe("72%");
    expect(meta.claims.length).toBeGreaterThan(0);
  });

  it("privacidade: sem autorização da organização o perfil da marca não vai ao provedor", async () => {
    mock.reset();
    mock.state.reply = JSON.stringify(PLAN);
    await generateCarousel(ctx.actor, { topic: "Energia solar em casa", clientId, images: "none", selection: TEXT });
    const call = mock.generationCalls().find((c) => c.url.includes("api.anthropic.com/v1/messages"))!;
    expect(JSON.stringify(call.body)).not.toContain("Tom secreto da marca");
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: true }));
    mock.reset();
    await generateCarousel(ctx.actor, { topic: "Energia solar em casa", clientId, images: "none", selection: TEXT });
    const call2 = mock.generationCalls().find((c) => c.url.includes("api.anthropic.com/v1/messages"))!;
    expect(JSON.stringify(call2.body)).toContain("Tom secreto da marca");
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: false }));
  });

  it("modelo de imagem escolhido e indisponível: erro, sem troca silenciosa de provedor", async () => {
    await expect(
      as(ctx.actor, (s) =>
        prepareCarousel(s, {
          topic: "Energia solar",
          selection: TEXT,
          imageSelection: { mode: "manual", provider: "gemini", model: "x" },
        }),
      ),
    ).rejects.toBeInstanceOf(ModelSelectionError);
  });

  it("pede confirmação de custo acima do limite e segue quando confirmado", async () => {
    await as(ctx.actor, (s) =>
      updateAiSettings(s, { ...policy, allowClientContext: false, confirmAboveUsd: 0.000001 }),
    );
    await expect(
      as(ctx.actor, (s) => prepareCarousel(s, { topic: "Energia solar", selection: TEXT, images: "none" })),
    ).rejects.toBeInstanceOf(CostConfirmationError);
    mock.state.reply = JSON.stringify(PLAN);
    const r = await generateCarousel(ctx.actor, {
      topic: "Energia solar",
      selection: TEXT,
      images: "none",
      confirmCost: true,
    });
    expect(r.ok).toBe(true);
    await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: false, confirmAboveUsd: 0 }));
  });

  it("falha do provedor: erro transmitido, uso registrado como erro e nenhuma arte salva", async () => {
    mock.reset();
    mock.state.failStatus = 500;
    const r = await generateCarousel(ctx.actor, { topic: "Tema com falha", selection: TEXT, images: "none" });
    expect(r.ok).toBe(false);
    expect(r.events.at(-1)).toMatchObject({ t: "error" });
    expect(r.events.some((e) => e.t === "step" && e.step === "save")).toBe(false);
    const [u] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(aiUsage).where(eq(aiUsage.operation, "carousel_plan")).orderBy(desc(aiUsage.createdAt)).limit(1),
    );
    expect(u).toMatchObject({ status: "error" });
    mock.state.failStatus = null;
  });

  it("importar JPG com leitura de imagens: textos e blocos editáveis; original oculta e bloqueada", async () => {
    mock.reset();
    mock.state.reply = JSON.stringify({
      background: "#F6F1E9",
      notes: "",
      elements: [
        {
          kind: "shape",
          x: 0,
          y: 0.7,
          width: 1,
          height: 0.3,
          text: "",
          fontSize: 0,
          fontWeight: 400,
          font: "sans",
          align: "left",
          color: "#000000",
          shape: "rect",
          fill: "#C2410C",
          radius: 0,
        },
        {
          kind: "text",
          x: 0.08,
          y: 0.1,
          width: 0.84,
          height: 0.2,
          text: "Promoção de inverno",
          fontSize: 0.06,
          fontWeight: 800,
          font: "display",
          align: "left",
          color: "#1E1B16",
          shape: "rect",
          fill: "",
          radius: 0,
        },
        {
          kind: "text",
          x: 0.08,
          y: 0.75,
          width: 0.84,
          height: 0.1,
          text: "Só até domingo",
          fontSize: 0.03,
          fontWeight: 400,
          font: "sans",
          align: "center",
          color: "#FFFFFF",
          shape: "rect",
          fill: "",
          radius: 0,
        },
      ],
    });
    const jpg = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#F6F1E9" } })
      .jpeg()
      .toBuffer();
    const res = await importImageAsTemplate(
      ctx.actor,
      { buffer: jpg, originalName: "promo.jpg" },
      { reconstruct: true, selection: TEXT },
    );
    expect(res.reconstructed).toBe(true);
    expect(res.layers).toBe(3);
    const call = mock.generationCalls().find((c) => c.url.includes("/v1/messages"))!;
    const content = (call.body!.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content[0]!.type).toBe("image");
    const { doc: d } = await doc(ctx.actor, res.id);
    const objs = d.pages[0]!.objects;
    expect(objs[0]).toMatchObject({ type: "image", hidden: true, locked: true });
    expect(objs.filter((o) => o.type === "text").map((o) => (o as TextObject).text)).toEqual([
      "Promoção de inverno",
      "Só até domingo",
    ]);
    expect(objs.some((o) => o.type === "rect")).toBe(true);
    expect(d.pages[0]!.background).toBe("#F6F1E9");
    expect(d.meta?.imported?.reconstructed).toBe(true);

    // Falha da leitura: cria só o fundo e explica (nada é escondido).
    mock.state.failStatus = 500;
    const failed = await importImageAsTemplate(
      ctx.actor,
      { buffer: jpg, originalName: "promo2.jpg" },
      { reconstruct: true, selection: TEXT },
    );
    expect(failed.reconstructed).toBe(false);
    expect(failed.message).toMatch(/falhou/);
    mock.state.failStatus = null;
  });
});
