import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOperations,
  DESIGN_SCHEMA,
  fileSrc,
  imageObject,
  locate,
  textObject,
  type DesignDocument,
  type ImageObject,
} from "@/lib/design-doc";
import {
  buildImagePrompt,
  cropToRatio,
  IMAGE_PROVIDER_OPTIONS,
  insertImageOps,
  outputSizeFor,
  providerSizeFor,
  ratioLabel,
  ratioOf,
} from "@/lib/image-gen";
import { AiProviderError } from "@/server/ai/types";
import type { Actor } from "@/server/authz";
import { withSystem } from "@/server/db";
import { aiGenerations, aiUsage, files, fileVersions } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { CostConfirmationError, updateAiSettings } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { saveProviderKey, setProviderEnabled } from "@/server/services/ai-providers";
import { createClient, updateBrandProfile } from "@/server/services/clients";
import { POLICY_MESSAGE } from "@/server/services/design-ai";
import {
  describeImageContext,
  enhanceImagePrompt,
  imageNote,
  listGeneratedImages,
  prepareDesignImageGeneration,
  recordDesignImageGenError,
  saveDesignImageGeneration,
} from "@/server/services/design-image-gen";
import { createDesign, getDesign, saveDesign } from "@/server/services/designs";
import { storeUpload } from "@/server/services/files";
import { createProject } from "@/server/services/projects";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Gerar imagem no editor (Estúdio Criador): regras puras de formato e
 * inserção, preparação com o modelo real da conta, geração com a Images API
 * simulada (mesmo formato da API oficial), arquivos em Arquivos, uso e
 * histórico, inserção na arte com persistência, biblioteca, erros e a
 * melhoria da descrição. Nenhuma chamada sai da máquina.
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const KEY_ANTHROPIC = "sk-ant-gerar-imagem-0001";
const KEY_OPENAI = "sk-openai-gerar-imagem-0001";
const KEY_ANTHROPIC_TEXT = "sk-ant-so-texto-0002";
const PROMPT = "Frasco de perfume premium sobre mármore preto";

const docOf = async (actor: Actor, id: string) =>
  (await as(actor, (s) => getDesign(s, id))).design.document as unknown as DesignDocument;

/** Carrossel de 3 slides com textos (o contexto do slide e do carrossel vem daqui). */
function carousel(): Record<string, unknown> {
  const page = (id: string, name: string, objects: unknown[]) => ({
    id,
    name,
    width: 1080,
    height: 1350,
    background: "#ffffff",
    objects,
  });
  return {
    schema: DESIGN_SCHEMA,
    meta: { carousel: true },
    components: [],
    pages: [
      page("p1", "Capa", [
        textObject({ id: "t1", name: "Título", text: "Lançamento Noite Âmbar", width: 900, fontSize: 80 }),
        textObject({ id: "t2", name: "Apoio", text: "O perfume da estação", width: 900, fontSize: 32 }),
      ]),
      page("p2", "Benefício", [
        textObject({ id: "t3", name: "Título 2", text: "Fixação de 12 horas", width: 900, fontSize: 72 }),
        imageObject({
          id: "i1",
          name: "Foto antiga",
          src: fileSrc("11111111-1111-4111-8111-111111111111"),
          naturalWidth: 400,
          naturalHeight: 300,
          x: 90,
          y: 500,
          width: 400,
          height: 300,
        }),
      ]),
      page("p3", "CTA", [textObject({ id: "t5", name: "CTA", text: "Garanta o seu", width: 900, fontSize: 64 })]),
    ],
  };
}

describe("gerar imagem no editor — regras puras", () => {
  it("proporções: formatos fixos, formato do slide e personalizado (com limites)", () => {
    expect(ratioOf("square", null, null)).toEqual({ w: 1, h: 1 });
    expect(ratioOf("portrait", null, null)).toEqual({ w: 4, h: 5 });
    expect(ratioOf("story", null, null)).toEqual({ w: 9, h: 16 });
    expect(ratioOf("landscape", null, null)).toEqual({ w: 16, h: 9 });
    expect(ratioOf("page", { width: 1080, height: 1350 }, null)).toEqual({ w: 1080, h: 1350 });
    expect(ratioLabel({ w: 1080, h: 1350 })).toBe("4:5");
    expect(ratioLabel({ w: 1920, h: 1080 })).toBe("16:9");
    expect(ratioOf("page", null, null)).toBeNull();
    expect(ratioOf("custom", null, { w: 3, h: 2 })).toEqual({ w: 3, h: 2 });
    // Proporções extremas (acima de 3:1) ou valores inválidos não passam.
    expect(ratioOf("custom", null, { w: 4, h: 1 })).toBeNull();
    expect(ratioOf("custom", null, { w: 0, h: 2 })).toBeNull();
  });

  it("tamanho pedido ao provedor é o mais próximo e o recorte central dá a proporção exata", () => {
    const sizes = IMAGE_PROVIDER_OPTIONS.openai!.sizes;
    expect(providerSizeFor({ w: 4, h: 5 }, sizes)).toEqual({ w: 1024, h: 1536 });
    expect(providerSizeFor({ w: 9, h: 16 }, sizes)).toEqual({ w: 1024, h: 1536 });
    expect(providerSizeFor({ w: 16, h: 9 }, sizes)).toEqual({ w: 1536, h: 1024 });
    expect(providerSizeFor({ w: 1, h: 1 }, sizes)).toEqual({ w: 1024, h: 1024 });
    expect(cropToRatio({ w: 1024, h: 1536 }, { w: 4, h: 5 })).toEqual({ width: 1024, height: 1280, left: 0, top: 128 });
    expect(cropToRatio({ w: 1024, h: 1536 }, { w: 9, h: 16 })).toEqual({ width: 864, height: 1536, left: 80, top: 0 });
    expect(cropToRatio({ w: 1536, h: 1024 }, { w: 16, h: 9 })).toEqual({ width: 1536, height: 864, left: 0, top: 80 });
    expect(cropToRatio({ w: 1024, h: 1024 }, { w: 1, h: 1 })).toEqual({ width: 1024, height: 1024, left: 0, top: 0 });
    expect(outputSizeFor({ w: 1080, h: 1350 }, sizes)).toEqual({ base: { w: 1024, h: 1536 }, width: 1024, height: 1280 });
    // A OpenAI não tem prompt negativo nem mais de 4 variações por vez nesta integração.
    expect(IMAGE_PROVIDER_OPTIONS.openai).toMatchObject({ negativePrompt: false, maxVariations: 4 });
    expect(Object.keys(IMAGE_PROVIDER_OPTIONS.openai!.qualities!)).toEqual(["auto", "low", "medium", "high"]);
  });

  it("prompt final: descrição + estilo + contexto; sem estilo e sem contexto vai só a descrição", () => {
    expect(buildImagePrompt({ prompt: `  ${PROMPT}  ` })).toBe(PROMPT);
    const full = buildImagePrompt({ prompt: PROMPT, style: "advertising", context: "Contexto: slide 1" });
    expect(full.startsWith(PROMPT)).toBe(true);
    expect(full).toContain("Estilo: Fotografia publicitária");
    expect(full.endsWith("Contexto: slide 1")).toBe(true);
    expect(buildImagePrompt({ prompt: PROMPT, style: "none", negativePrompt: "texto" })).toBe(`${PROMPT}\n\nEvite: texto`);
  });

  it("contexto do slide e do carrossel: textos, sequência, imagens anteriores e identidade", () => {
    const doc = carousel() as unknown as DesignDocument;
    const base = { doc, design: { name: "Campanha" }, clientName: "Perfumaria Lis", previousPrompts: [], brand: null };
    expect(describeImageContext({ ...base, pageId: "p2", mode: "none" })).toBeNull();
    const slide = describeImageContext({ ...base, pageId: "p2", mode: "slide" })!;
    expect(slide).toContain("Slide 2 de 3");
    expect(slide).toContain("Fixação de 12 horas");
    expect(slide).not.toContain("Lançamento Noite Âmbar");
    expect(slide).toContain("1 imagem(ns)");
    expect(slide).toContain("NÃO escreva textos");
    const all = describeImageContext({
      ...base,
      pageId: "p1",
      mode: "carousel",
      previousPrompts: ["Frasco âmbar em fundo escuro"],
      brand: {
        colors: ["#111111", "#C9A227"],
        fonts: ["Playfair Display"],
        toneOfVoice: "Elegante",
        audience: "Mulheres 25–45",
        keywords: ["luxo"],
        avoid: "cores neon",
      },
    })!;
    expect(all).toContain("Sequência dos slides: 1. \"Lançamento Noite Âmbar\" → 2. \"Fixação de 12 horas\" → 3. \"Garanta o seu\"");
    expect(all).toContain("Imagens já geradas nesta arte");
    expect(all).toContain("Frasco âmbar em fundo escuro");
    expect(all).toContain("cores #111111, #C9A227");
    expect(all).toContain("Evitar na marca: cores neon");
  });

  it("inserção: elemento centralizado em 80 % da página, fundo cobrindo a página e substituição mantendo a caixa", () => {
    const doc = carousel() as unknown as DesignDocument;
    const page = doc.pages[1]!;
    const image = { src: fileSrc("22222222-2222-4222-8222-222222222222"), width: 1024, height: 1280, name: "IA: frasco" };

    const el = insertImageOps(page, image, "element");
    const withEl = applyOperations(doc, el.ops).doc;
    const added = locate(withEl, el.id)!;
    expect(added.pageId).toBe("p2");
    const o = added.object as ImageObject;
    // Cabe em 80 % de 1080×1350 (864×1080) mantendo 4:5: 864×1080, centralizada.
    expect([o.width, o.height]).toEqual([864, 1080]);
    expect([o.x, o.y]).toEqual([108, 135]);
    expect(o).toMatchObject({ type: "image", src: image.src, naturalWidth: 1024, naturalHeight: 1280, crop: null });
    expect(withEl.pages[1]!.objects.at(-1)!.id).toBe(el.id);

    const bg = insertImageOps(page, { ...image, width: 1024, height: 1024 }, "background");
    const withBg = applyOperations(doc, bg.ops).doc;
    const b = withBg.pages[1]!.objects[0] as ImageObject;
    expect(b.id).toBe(bg.id);
    expect([b.x, b.y, b.width, b.height]).toEqual([0, 0, 1080, 1350]);
    // Recorte "preencher": usa toda a altura da imagem quadrada e corta as laterais.
    expect(b.crop).toMatchObject({ y: 0, height: 1024 });
    expect(b.crop!.width).toBeCloseTo(819.2, 1);

    const rep = insertImageOps(page, image, "replace", "i1");
    const withRep = applyOperations(doc, rep.ops).doc;
    const r = locate(withRep, "i1")!.object as ImageObject;
    expect(r).toMatchObject({ src: image.src, naturalWidth: 1024, naturalHeight: 1280, x: 90, y: 500, width: 400, height: 300 });
    expect(r.crop).not.toBeNull();
    expect(() => insertImageOps(page, image, "replace")).toThrow(/Selecione/);
    // A operação inversa remove o que foi inserido (desfazer).
    expect(applyOperations(withEl, applyOperations(doc, el.ops).inverse).doc).toEqual(doc);
  });
});

describe("gerar imagem no editor — serviço", () => {
  let real: Ctx;
  let demo: Ctx;
  let textOnly: Ctx;
  let mock: ReturnType<typeof installAiMock>;
  let clientId: string;
  let otherClient: string;
  let projectId: string;
  let designId: string;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY };
  const base = () => ({ designId, prompt: PROMPT, pageId: "p2" });

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    env.OPENAI_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add(KEY_ANTHROPIC);
    mock.state.valid.anthropic.add(KEY_ANTHROPIC_TEXT);
    mock.state.valid.openai.add(KEY_OPENAI);
    await resetDb();

    real = await createOrgWithOwner("Agência Gerar Imagem");
    expect((await as(real.actor, (s) => saveProviderKey(s, "anthropic", KEY_ANTHROPIC))).ok).toBe(true);
    expect((await as(real.actor, (s) => saveProviderKey(s, "openai", KEY_OPENAI))).ok).toBe(true);
    await as(real.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    clientId = (await as(real.actor, (s) => createClient(s, { name: "Perfumaria Lis" }))).id;
    otherClient = (await as(real.actor, (s) => createClient(s, { name: "Outra Marca" }))).id;
    await as(real.actor, (s) =>
      updateBrandProfile(s, {
        clientId,
        toneOfVoice: "Elegante e direto",
        audience: "Mulheres de 25 a 45 anos",
        keywords: ["luxo acessível"],
        colors: [{ name: "Âmbar", hex: "#C9A227" }],
        fonts: [{ name: "Playfair Display" }],
      }),
    );
    projectId = (await as(real.actor, (s) => createProject(s, { clientId, name: "Lançamento Noite Âmbar" }))).id;
    designId = (
      await as(real.actor, (s) =>
        createDesign(s, {
          name: "Carrossel Noite Âmbar",
          width: 1080,
          height: 1350,
          clientId,
          projectId,
          document: carousel(),
        }),
      )
    ).id;

    demo = await createOrgWithOwner("Agência Demo Imagem", "Dona Demo");
    await as(demo.actor, (s) => setProviderEnabled(s, "demo", true));

    textOnly = await createOrgWithOwner("Agência Só Texto");
    expect((await as(textOnly.actor, (s) => saveProviderKey(s, "anthropic", KEY_ANTHROPIC_TEXT))).ok).toBe(true);
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    env.OPENAI_API_KEY = saved.openai;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("prepara com o modelo de imagem da conta; opções fora do provedor e contexto sem autorização são recusados", async () => {
    // Contexto de uma arte de cliente sem a política liberada: recusado antes de gastar.
    const blocked = await as(real.actor, (s) =>
      prepareDesignImageGeneration(s, { ...base(), context: "slide" }),
    ).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(ValidationError);
    expect((blocked as Error).message).toBe(POLICY_MESSAGE);

    // Sem contexto: só a descrição (e o estilo) vão ao provedor.
    const plain = await as(real.actor, (s) =>
      prepareDesignImageGeneration(s, { ...base(), format: "portrait", style: "cinematic", quality: "high" }),
    );
    expect(plain.model.id).toBe("gpt-image-1");
    expect(plain.providerId).toBe("openai");
    expect(plain.size).toEqual({ w: 1024, h: 1536 });
    expect(plain.output).toEqual({ width: 1024, height: 1280 });
    expect(plain.finalPrompt).toContain(PROMPT);
    expect(plain.finalPrompt).toContain("Estilo: Estética cinematográfica");
    expect(plain.finalPrompt).not.toContain("Contexto");
    expect(plain.contextUsed).toBe(false);
    expect(plain.quality).toBe("high");

    // Formato do slide: proporção da página ativa (p2 = 1080×1350).
    const page = await as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), format: "page" }));
    expect(ratioLabel(page.ratio)).toBe("4:5");

    await expect(
      as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), quality: "ultra" })),
    ).rejects.toThrow(/não aceita a qualidade/);
    await expect(
      as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), negativePrompt: "texto" })),
    ).rejects.toThrow(/instruções negativas/);
    await expect(
      as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), format: "custom", customRatio: { w: 4, h: 1 } })),
    ).rejects.toThrow(/Proporção inválida/);
    await expect(
      as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), variations: 7 })),
    ).rejects.toThrow();
    // Modelo escolhido à mão que não gera imagens: erro com alternativas (nunca troca em silêncio).
    const wrong = await as(real.actor, (s) =>
      prepareDesignImageGeneration(s, { ...base(), ai: { mode: "manual", provider: "openai", model: "gpt-5.1" } }),
    ).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(ModelSelectionError);
    expect((wrong as ModelSelectionError).alternatives.map((a) => a.model)).toContain("gpt-image-1");
    expect(mock.generationCalls()).toHaveLength(0);
  });

  it("com a política liberada, o contexto do slide entra no prompt (textos, cliente e identidade)", async () => {
    await as(real.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: true, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    const p = await as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), context: "slide" }));
    expect(p.contextUsed).toBe(true);
    expect(p.finalPrompt).toContain("Slide 2 de 3");
    expect(p.finalPrompt).toContain("Fixação de 12 horas");
    expect(p.finalPrompt).toContain("Perfumaria Lis");
    expect(p.finalPrompt).toContain("#C9A227");
    expect(p.finalPrompt).toContain("Playfair Display");
    expect(p.finalPrompt).not.toContain("Garanta o seu");
    const c = await as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), context: "carousel" }));
    expect(c.finalPrompt).toContain("Sequência dos slides");
    expect(c.finalPrompt).toContain("Garanta o seu");
  });

  it("gera 2 variações (n, quality e size reais na API), recorta para 4:5, salva em Arquivos, registra uso e histórico", async () => {
    mock.state.imageSize = "request";
    const prepared = await as(real.actor, (s) =>
      prepareDesignImageGeneration(s, {
        ...base(),
        format: "portrait",
        style: "advertising",
        quality: "high",
        variations: 2,
        context: "slide",
      }),
    );
    const started = Date.now();
    const output = await prepared.run();
    const call = mock.generationCalls().find((c) => c.url.endsWith("/v1/images/generations"))!;
    expect(call.body).toMatchObject({ model: "gpt-image-1", size: "1024x1536", n: 2, quality: "high", output_format: "png" });
    expect(String(call.body!.prompt)).toContain("Estilo: Fotografia publicitária");
    expect(output.images).toHaveLength(2);

    const result = await as(real.actor, (s) => saveDesignImageGeneration(s, prepared, output, Date.now() - started));
    expect(result.images).toHaveLength(2);
    expect(result).toMatchObject({ provider: "openai", model: "gpt-image-1", ratio: "4:5", contextUsed: true, pageId: "p2" });
    for (const img of result.images) {
      expect(img.src).toBe(fileSrc(img.versionId));
      expect([img.width, img.height]).toEqual([1024, 1280]);
      const [file] = await withSystem((tx) => tx.select().from(files).where(eq(files.id, img.fileId)));
      expect(file).toMatchObject({ clientId, projectId, category: "general" });
      expect(file!.tags).toEqual(expect.arrayContaining(["ia", "estudio"]));
      const [version] = await withSystem((tx) => tx.select().from(fileVersions).where(eq(fileVersions.id, img.versionId)));
      expect(version).toMatchObject({ source: "ai", width: 1024, height: 1280, mimeType: "image/png" });
      expect(version!.note).toBe(imageNote("gpt-image-1", "Carrossel Noite Âmbar", PROMPT));
    }
    const [gen] = await withSystem((tx) => tx.select().from(aiGenerations).where(eq(aiGenerations.id, result.generationId)));
    expect(gen).toMatchObject({ kind: "image_generate", provider: "openai", model: "gpt-image-1", clientId });
    expect(gen!.input).toMatchObject({ designId, pageId: "p2", prompt: PROMPT, variations: 2, format: "portrait" });
    const [usage] = await withSystem((tx) => tx.select().from(aiUsage).where(eq(aiUsage.id, gen!.usageId!)));
    expect(usage).toMatchObject({
      status: "success",
      module: "editor",
      task: "image_generation",
      operation: "image_generate",
      projectId,
      outputTokens: 544,
    });

    // A descrição desta geração passa a orientar as próximas (continuidade entre slides).
    const next = await as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), context: "carousel" }));
    expect(next.finalPrompt).toContain(`Imagens já geradas nesta arte (mantenha coerência de estilo): "${PROMPT}"`);

    // Inserção no slide ativo pelo caminho normal e persistência ao salvar e reabrir.
    const before = await docOf(real.actor, designId);
    const page = before.pages[1]!;
    const first = result.images[0]!;
    const second = result.images[1]!;
    const el = insertImageOps(page, { ...first, name: "IA: frasco" }, "element");
    const bg = insertImageOps(before.pages[2]!, { ...second, name: "IA: fundo" }, "background");
    const rep = insertImageOps(page, { ...second, name: "IA: troca" }, "replace", "i1");
    const nextDoc = applyOperations(before, [...el.ops, ...bg.ops, ...rep.ops]).doc;
    const savedDesign = await as(real.actor, (s) =>
      saveDesign(s, { id: designId, revision: 1, document: nextDoc as unknown as Record<string, unknown> }),
    );
    expect(savedDesign.revision).toBe(2);
    const reopened = await docOf(real.actor, designId);
    expect((locate(reopened, el.id)!.object as ImageObject).src).toBe(first.src);
    expect(locate(reopened, el.id)!.pageId).toBe("p2");
    const fundo = reopened.pages[2]!.objects[0] as ImageObject;
    expect(fundo).toMatchObject({ id: bg.id, src: second.src, x: 0, y: 0, width: 1080, height: 1350 });
    expect((locate(reopened, "i1")!.object as ImageObject)).toMatchObject({ src: second.src, width: 400, height: 300 });
    // Os textos do slide continuam intactos.
    expect(locate(reopened, "t3")?.object).toEqual(locate(before, "t3")?.object);

    // Biblioteca de geradas: as duas imagens, com descrição e modelo; nada de outro cliente.
    const lib = await as(real.actor, (s) => listGeneratedImages(s, { designId }));
    expect(lib.items.map((i) => i.versionId).sort()).toEqual([first.versionId, second.versionId].sort());
    expect(lib.items[0]).toMatchObject({ prompt: PROMPT, model: "gpt-image-1", width: 1024, height: 1280 });
    const otherDesign = await as(real.actor, (s) =>
      createDesign(s, { name: "Arte da outra marca", width: 1080, height: 1080, clientId: otherClient }),
    );
    expect((await as(real.actor, (s) => listGeneratedImages(s, { designId: otherDesign.id }))).items).toEqual([]);
  });

  it("confirmação de custo: com aviso configurado a geração pede confirmação explícita", async () => {
    await as(real.actor, (s) =>
      updateAiSettings(s, {
        enabled: true,
        allowClientContext: true,
        monthlyTokenLimit: 0,
        userDailyRequestLimit: 0,
        confirmAboveUsd: 0.01,
      }),
    );
    const err = await as(real.actor, (s) => prepareDesignImageGeneration(s, base())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CostConfirmationError);
    const ok = await as(real.actor, (s) => prepareDesignImageGeneration(s, { ...base(), confirmCost: true }));
    expect(ok.model.id).toBe("gpt-image-1");
    await as(real.actor, (s) =>
      updateAiSettings(s, {
        enabled: true,
        allowClientContext: true,
        monthlyTokenLimit: 0,
        userDailyRequestLimit: 0,
        confirmAboveUsd: 0,
      }),
    );
  });

  it("falhas: provedor fora do ar registra erro; sem modelo de imagem, demonstração e sem permissão não geram", async () => {
    const prepared = await as(real.actor, (s) => prepareDesignImageGeneration(s, base()));
    mock.state.failStatus = 500;
    const err = await prepared.run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).kind).toBe("unavailable");
    await as(real.actor, (s) => recordDesignImageGenError(s, prepared, (err as Error).message, 10));
    const rows = await withSystem((tx) => tx.select().from(aiUsage).where(eq(aiUsage.status, "error")));
    expect(rows.some((r) => r.operation === "image_generate" && r.errorMessage?.includes("500"))).toBe(true);
    mock.state.failStatus = null;

    // Organização só com modelo de texto: nenhum modelo compatível, com orientação.
    const textDesign = await as(textOnly.actor, (s) =>
      createDesign(s, { name: "Só texto", width: 1080, height: 1080 }),
    );
    const none = await as(textOnly.actor, (s) =>
      prepareDesignImageGeneration(s, { designId: textDesign.id, prompt: PROMPT }),
    ).catch((e: unknown) => e);
    expect(none).toBeInstanceOf(ModelSelectionError);
    expect((none as ModelSelectionError).reason).toBe("no_compatible");
    expect((none as Error).message).toMatch(/gpt-image/);

    // Demonstração local: não gera imagens (nunca um resultado simulado).
    const demoDesign = await as(demo.actor, (s) => createDesign(s, { name: "Demo", width: 1080, height: 1080 }));
    const demoErr = await as(demo.actor, (s) =>
      prepareDesignImageGeneration(s, { designId: demoDesign.id, prompt: PROMPT }),
    ).catch((e: unknown) => e);
    expect(demoErr).toBeInstanceOf(ModelSelectionError);

    // Sem permissão de edição de artes (financeiro) e arte de cliente sem acesso (colaborador).
    const finance = await addMember(real.org.slug, real.org.id, "finance");
    await expect(as(finance, (s) => prepareDesignImageGeneration(s, base()))).rejects.toBeInstanceOf(ForbiddenError);
    const collaborator = await addMember(real.org.slug, real.org.id, "collaborator");
    await expect(as(collaborator, (s) => prepareDesignImageGeneration(s, base()))).rejects.toThrow();
    expect(mock.generationCalls().filter((c) => c.url.endsWith("/v1/images/generations"))).toHaveLength(1);
  });

  it("melhorar a descrição: a demonstração preserva o texto; o modelo real devolve o JSON pedido", async () => {
    const demoDesign = await as(demo.actor, (s) =>
      createDesign(s, { name: "Demo melhoria", width: 1080, height: 1080, document: carousel() }),
    );
    const d = await enhanceImagePrompt(demo.actor, {
      designId: demoDesign.id,
      prompt: PROMPT,
      style: "advertising",
      context: "slide",
      pageId: "p1",
    });
    expect(d.demo).toBe(true);
    expect(d.original).toBe(PROMPT);
    expect(d.prompt.startsWith(PROMPT)).toBe(true);
    expect(d.prompt).toContain("Estilo publicitário");
    expect(d.prompt).toContain("Sem texto escrito");
    expect(d.prompt).toContain("Exemplo da demonstração");
    expect(d.contextUsed).toBe(true);

    mock.state.reply = JSON.stringify({ prompt: `${PROMPT}, luz lateral suave, lente 85 mm, fundo escuro com reflexos.` });
    const r = await enhanceImagePrompt(real.actor, { designId, prompt: PROMPT, style: "photographic" });
    expect(r.demo).toBe(false);
    expect(r.prompt).toContain("lente 85 mm");
    expect(r.model).toBe("claude-sonnet-5-5");
    const call = mock.generationCalls().find((c) => c.url.includes("/v1/messages"))!;
    expect(JSON.stringify(call.body)).toContain("Formato da resposta: image_prompt");
    const gens = await withSystem((tx) => tx.select().from(aiGenerations).where(eq(aiGenerations.kind, "image_prompt")));
    expect(gens.map((g) => g.provider).sort()).toEqual(["anthropic", "demo"]);
  });

  it("imagens de outra origem não entram na biblioteca de geradas", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
    await as(real.actor, (s) =>
      storeUpload(s, { buffer: png, originalName: "enviada.png" }, { clientId, category: "general", source: "upload" }),
    );
    const lib = await as(real.actor, (s) => listGeneratedImages(s, { designId }));
    expect(lib.items.every((i) => i.model === "gpt-image-1")).toBe(true);
    expect(lib.items).toHaveLength(2);
  });
});
