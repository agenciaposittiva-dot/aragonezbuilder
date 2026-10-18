import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESIGN_SCHEMA,
  fileSrc,
  imageObject,
  locate,
  rectObject,
  textObject,
  type DesignDocument,
  type TextObject,
} from "@/lib/design-doc";
import { buildDirection } from "@/lib/carousel-gen/direction";
import { generatorMetaSchema } from "@/lib/design-doc/generator";
import { demoSpellFix } from "@/server/ai/demo-design";
import { AiProviderError } from "@/server/ai/types";
import type { Actor } from "@/server/authz";
import { withSystem } from "@/server/db";
import { aiProviderConfigs, aiUsage, files } from "@/server/db/schema";
import { env } from "@/server/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { updateAiSettings } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { readyProviders, saveProviderKey, setProviderEnabled } from "@/server/services/ai-providers";
import { runGeneration, type GenerationEvent } from "@/server/services/ai-run";
import { createClient } from "@/server/services/clients";
import {
  designAiSetup,
  listDesignAiHistory,
  normalizeDesignAi,
  POLICY_MESSAGE,
  prepareDesignAi,
  prepareDesignImage,
  saveDesignImage,
  setDesignAiOutcome,
} from "@/server/services/design-ai";
import { designAiTools } from "@/server/services/design-ai-tools";
import { listDesignVersions } from "@/server/services/design-versions";
import { applyDesignOperations, createDesign, getDesign } from "@/server/services/designs";
import { storeUpload } from "@/server/services/files";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Chat de edição de artes por IA (acceptance da Frente L): o modelo propõe
 * operações e ações; o servidor valida, simula (antes/depois) e só grava
 * quando a pessoa aplica — com versão anterior e desfazer pelo inverso.
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const KEY_ANTHROPIC = "sk-ant-chat-arte-0001";
const KEY_OPENAI = "sk-openai-chat-arte-0001";

const png = (w = 64, h = 48) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 110, b: 190 } } })
    .png()
    .toBuffer();

/** Prepara, gera e normaliza — o mesmo caminho da rota /api/designs/ai (nada é gravado na arte). */
async function ask(actor: Actor, req: Parameters<typeof prepareDesignAi>[1]) {
  const prepared = await as(actor, (s) => prepareDesignAi(s, req));
  const events: GenerationEvent[] = [];
  await runGeneration(actor, prepared.generation, prepared.input, { send: (e) => events.push(e) });
  const done = events.find((e) => e.t === "done");
  if (!done) throw new AiProviderError(events.find((e) => e.t === "error")?.message ?? "sem resposta", "unavailable");
  return { prepared, generationId: done.generationId, result: normalizeDesignAi(prepared.ctx, done.data) };
}

/** Plano do gerador de carrosséis (formato real de document.meta.generator). */
const GENERATOR = generatorMetaSchema.parse({
  v: 1,
  mode: "quick",
  input: { topic: "Promoção de verão" },
  plan: { title: "Promoção de verão" },
  slides: ["Capa", "Dica", "CTA"].map((title, i) => ({
    key: `s${i + 1}`,
    pageId: `p${i + 1}`,
    role: i === 0 ? "cover" : i === 2 ? "cta" : "insight",
    title,
    visual: { kind: "icon" },
    layout: "point-left",
  })),
  direction: buildDirection({ seed: 7, topic: "Promoção de verão", identity: null }),
  ai: { provider: "demo", model: "demo", demo: true },
  visuals: "vector",
  version: 1,
  createdAt: "2026-10-18T00:00:00.000Z",
});

const docOf = async (actor: Actor, id: string) =>
  (await as(actor, (s) => getDesign(s, id))).design.document as unknown as DesignDocument;
const textOf = (doc: DesignDocument, id: string) => (locate(doc, id)?.object as TextObject | undefined)?.text;

function carousel(): Record<string, unknown> {
  const page = (id: string, objects: unknown[]) => ({
    id,
    name: id,
    width: 1080,
    height: 1080,
    background: "#ffffff",
    objects,
  });
  return {
    schema: DESIGN_SCHEMA,
    meta: { carousel: true },
    components: [],
    pages: [
      page("p1", [
        textObject({
          id: "t1",
          name: "Título",
          text: "Promocao imperdivel",
          width: 900,
          fontSize: 80,
          color: "#111111",
        }),
        textObject({ id: "t2", name: "Apoio", text: "Texto já correto.", width: 900, fontSize: 32 }),
        rectObject({ id: "r1", name: "Faixa", x: 0, y: 900, width: 1080, height: 180, fill: "#F4BF2F" }),
      ]),
      page("p2", [
        textObject({ id: "t3", name: "Título 2", text: "Voce vai amar", width: 900, fontSize: 72 }),
        textObject({ id: "t4", name: "Rodapé", text: "Arraste para o lado", width: 600, fontSize: 24 }),
      ]),
      page("p3", [textObject({ id: "t5", name: "CTA", text: "Fale com a gente", width: 900, fontSize: 64 })]),
    ],
  };
}

describe("chat de edição de artes por IA", () => {
  let demo: Ctx;
  let real: Ctx;
  let mock: ReturnType<typeof installAiMock>;
  let demoClient: string;
  let otherClient: string;
  let realClient: string;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    env.OPENAI_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add(KEY_ANTHROPIC);
    mock.state.valid.openai.add(KEY_OPENAI);
    await resetDb();

    demo = await createOrgWithOwner("Agência Demo Arte", "Dona Demo");
    await as(demo.actor, (s) => setProviderEnabled(s, "demo", true));
    demoClient = (await as(demo.actor, (s) => createClient(s, { name: "Café Aurora" }))).id;
    otherClient = (await as(demo.actor, (s) => createClient(s, { name: "Outra Marca" }))).id;

    real = await createOrgWithOwner("Agência Real Arte");
    expect((await as(real.actor, (s) => saveProviderKey(s, "anthropic", KEY_ANTHROPIC))).ok).toBe(true);
    expect((await as(real.actor, (s) => saveProviderKey(s, "openai", KEY_OPENAI))).ok).toBe(true);
    await as(real.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    realClient = (await as(real.actor, (s) => createClient(s, { name: "Loja Segredo" }))).id;
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    env.OPENAI_API_KEY = saved.openai;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("corrige a ortografia sem tocar nos outros elementos; prévia antes/depois e nada gravado antes de aplicar", async () => {
    expect(demoSpellFix("Promocao imperdivel para voce")).toBe("Promoção imperdível para você");
    const { id } = await as(demo.actor, (s) =>
      createDesign(s, { name: "Carrossel", width: 1080, height: 1080, clientId: demoClient, document: carousel() }),
    );
    const before = await docOf(demo.actor, id);
    const { result, prepared } = await ask(demo.actor, {
      designId: id,
      message: "Corrija os erros de português",
      pageId: "p1",
    });
    expect(prepared.generation).toMatchObject({ demo: true, module: "editor", task: "design_edit" });
    expect(result.reply).toMatch(/^Exemplo \(modo demonstração\)/);
    expect(result.ops).toEqual([
      { op: "setText", id: "t1", text: "Promoção imperdível" },
      { op: "setText", id: "t3", text: "Você vai amar" },
    ]);
    expect(result.pages).toEqual([1, 2]);
    expect(result.changes).toEqual([
      {
        label: expect.stringContaining("Título"),
        field: "Texto",
        before: "Promocao imperdivel",
        after: "Promoção imperdível",
      },
      { label: expect.stringContaining("Título 2"), field: "Texto", before: "Voce vai amar", after: "Você vai amar" },
    ]);
    expect(result.inverse).toHaveLength(2);
    // Nada mudou no servidor só por pedir a proposta.
    expect((await as(demo.actor, (s) => getDesign(s, id))).design.revision).toBe(1);

    // Aplicar fora do editor: versão anterior nomeada + revisão controlada.
    const applied = await as(demo.actor, (s) =>
      applyDesignOperations(s, {
        designId: id,
        revision: prepared.ctx.revision,
        ops: result.ops,
        checkpointLabel: "Antes da edição pelo chat de IA",
      }),
    );
    expect(applied).toMatchObject({ saved: true, revision: 2 });
    const after = await docOf(demo.actor, id);
    expect(textOf(after, "t1")).toBe("Promoção imperdível");
    expect(textOf(after, "t3")).toBe("Você vai amar");
    // Os outros elementos ficam idênticos (fonte, cor, posição, texto).
    for (const keep of ["t2", "r1", "t4", "t5"])
      expect(locate(after, keep)?.object).toEqual(locate(before, keep)?.object);
    expect(locate(after, "t1")?.object).toEqual({ ...locate(before, "t1")!.object, text: "Promoção imperdível" });
    const versions = await as(demo.actor, (s) => listDesignVersions(s, id));
    expect(versions.some((v) => v.kind === "named" && v.label === "Antes da edição pelo chat de IA")).toBe(true);

    // Desfazer pelo inverso devolve o original.
    await as(demo.actor, (s) =>
      applyDesignOperations(s, { designId: id, revision: applied.revision, ops: applied.inverse }),
    );
    const undone = await docOf(demo.actor, id);
    expect(textOf(undone, "t1")).toBe("Promocao imperdivel");
    expect(textOf(undone, "t3")).toBe("Voce vai amar");
  });

  it("altera só o slide pedido e respeita a seleção; proposta antiga não sobrescreve alterações novas", async () => {
    const { id } = await as(demo.actor, (s) =>
      createDesign(s, { name: "Slides", width: 1080, height: 1080, document: carousel() }),
    );
    const slide = await ask(demo.actor, {
      designId: id,
      message: "Troque o título do slide 2 por uma frase mais impactante",
      pageId: "p1",
    });
    expect(slide.result.ops).toEqual([{ op: "setText", id: "t3", text: "Agora é a sua vez: Voce vai amar!" }]);
    expect(slide.result.pages).toEqual([2]);

    // Na página ativa, com um elemento selecionado: só ele muda.
    const sel = await ask(demo.actor, {
      designId: id,
      message: "Deixe esse texto mais comercial",
      pageId: "p3",
      selection: ["t5"],
    });
    expect(sel.result.ops).toEqual([{ op: "setText", id: "t5", text: "Fale com a gente — aproveite hoje!" }]);

    // O editor manda o próprio estado (com alterações ainda não salvas): a proposta parte dele.
    const local = carousel();
    (local.pages as { objects: { text?: string }[] }[])[1]!.objects[0]!.text = "Texto local novo";
    const fromLocal = await ask(demo.actor, {
      designId: id,
      message: "Deixe o título mais comercial",
      pageId: "p2",
      document: local,
    });
    expect(fromLocal.result.changes[0]).toMatchObject({ before: "Texto local novo" });

    // Alguém salvou depois da proposta: aplicar com a revisão antiga é recusado (nada é perdido).
    await as(demo.actor, (s) => applyDesignOperations(s, { designId: id, revision: 1, ops: sel.result.ops }));
    await expect(
      as(demo.actor, (s) => applyDesignOperations(s, { designId: id, revision: 1, ops: slide.result.ops })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("valida o que o modelo devolve: descarta operações inválidas, ferramentas desconhecidas e conta remoções", () => {
    const doc = carousel() as unknown as DesignDocument;
    const r = normalizeDesignAi(
      { doc },
      {
        reply: "Ok",
        ops: JSON.stringify([
          { op: "setText", id: "t2", text: "Novo apoio" },
          { op: "setText", id: "nao-existe", text: "x" },
          { op: "add", pageId: "p1", object: { id: "z", type: "rect" } },
          { op: "setStyle", ids: ["t1"], style: { fontSize: 64 } },
          { op: "remove", ids: ["r1"] },
          { op: "inventada" },
        ]),
        actions: JSON.stringify([
          { tool: "image_edit", args: { targetId: "t1", instruction: "não é imagem" } },
          { tool: "ferramenta_que_nao_existe", args: {} },
        ]),
        question: "",
      },
    );
    expect(r.ops.map((o) => o.op)).toEqual(["setText", "setStyle", "remove"]);
    expect(r.skipped).toBe(5);
    expect(r.removes).toBe(1);
    expect(r.actions).toEqual([]);
    expect(r.question).toBeNull();
    expect(r.changes.find((c) => c.field === "Tamanho da fonte")).toMatchObject({ before: 80, after: 64 });
    // Resposta fora do formato não quebra: vira proposta vazia.
    expect(normalizeDesignAi({ doc }, "lixo")).toMatchObject({ reply: "Pronto.", ops: [], actions: [] });
    // O registro de ferramentas é extensível (o chat não se limita a operações do documento).
    expect(designAiTools().map((t) => t.id)).toContain("image_edit");
  });

  it("nova versão de uma imagem existente: original como referência, arquivo novo em Arquivos e troca só da imagem", async () => {
    const upload = await as(demo.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "foto.png" }, { clientId: demoClient }),
    );
    const doc = carousel();
    (doc.pages as { objects: unknown[] }[])[0]!.objects.push(
      imageObject({ id: "img1", name: "Foto", src: fileSrc(upload.versionId), naturalWidth: 64, naturalHeight: 48 }),
    );
    const { id } = await as(demo.actor, (s) =>
      createDesign(s, { name: "Com foto", width: 1080, height: 1080, clientId: demoClient, document: doc }),
    );
    const { result } = await ask(demo.actor, {
      designId: id,
      message: "Gere uma nova versão desta imagem mais premium",
      pageId: "p1",
    });
    expect(result.ops).toEqual([]);
    expect(result.actions).toEqual([
      expect.objectContaining({
        tool: "image_edit",
        available: true,
        args: {
          targetId: "img1",
          instruction: "Gere uma nova versão desta imagem mais premium",
          src: fileSrc(upload.versionId),
        },
      }),
    ]);

    const filesBefore = await as(demo.actor, async (s) => (await s.db.select().from(files)).length);
    const prepared = await as(demo.actor, (s) =>
      prepareDesignImage(s, { designId: id, objectId: "img1", instruction: "mais premium e iluminada" }),
    );
    expect(prepared).toMatchObject({ demo: true, mode: "edit", task: "image_edit" });
    const output = await prepared.run();
    const edited = await as(demo.actor, (s) => saveDesignImage(s, prepared, output, 10));
    expect(edited.fileId).not.toBe(upload.fileId);
    expect(edited.op).toMatchObject({ op: "replaceImage", id: "img1", src: fileSrc(edited.versionId) });
    expect(await as(demo.actor, async (s) => (await s.db.select().from(files)).length)).toBe(filesBefore + 1);
    const [orig] = await as(demo.actor, (s) =>
      s.db
        .select()
        .from(files)
        .where(and(eq(files.id, upload.fileId), isNull(files.deletedAt))),
    );
    expect(orig).toBeTruthy(); // a original continua em Arquivos

    // Nada muda até aplicar; aplicando, só a imagem troca (a arte não é achatada).
    expect((await as(demo.actor, (s) => getDesign(s, id))).design.revision).toBe(1);
    await as(demo.actor, (s) =>
      applyDesignOperations(s, {
        designId: id,
        revision: 1,
        ops: [edited.op],
        checkpointLabel: "Antes da edição pelo chat de IA",
      }),
    );
    const after = await docOf(demo.actor, id);
    expect(after.pages[0]!.objects.map((o) => o.type)).toEqual(["text", "text", "rect", "image"]);
    expect((locate(after, "img1")!.object as { src: string }).src).toBe(fileSrc(edited.versionId));

    // Imagem de outro cliente não entra.
    const foreign = await as(demo.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "x.png" }, { clientId: otherClient }),
    );
    const bad = carousel();
    (bad.pages as { objects: unknown[] }[])[0]!.objects.push(
      imageObject({ id: "img2", src: fileSrc(foreign.versionId), naturalWidth: 64, naturalHeight: 48 }),
    );
    await expect(
      as(demo.actor, (s) =>
        prepareDesignImage(s, { designId: id, objectId: "img2", instruction: "outra", document: bad }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("instalação existente: a lista salva do provedor local ganha o modelo novo de edição de imagem", async () => {
    // Organizações que já usavam a demonstração guardaram a lista antiga de modelos (sem "demo-imagem").
    await withSystem((tx) =>
      tx
        .update(aiProviderConfigs)
        .set({ models: [{ id: "demo", label: "Demonstração" }] as never })
        .where(and(eq(aiProviderConfigs.organizationId, demo.org.id), eq(aiProviderConfigs.provider, "demo"))),
    );
    const { ready } = await as(demo.actor, (s) => readyProviders(s));
    expect(ready.find((p) => p.def.id === "demo")?.models.map((m) => m.id)).toEqual(["demo", "demo-imagem"]);
  });

  it("provedor real (OpenAI): envia a imagem original na edição; falha do provedor não salva nada", async () => {
    await as(real.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: true, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    const upload = await as(real.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "produto.png" }, { clientId: realClient }),
    );
    const doc = carousel();
    (doc.pages as { objects: unknown[] }[])[0]!.objects.push(
      imageObject({ id: "img1", src: fileSrc(upload.versionId), naturalWidth: 64, naturalHeight: 48 }),
    );
    const { id } = await as(real.actor, (s) =>
      createDesign(s, { name: "Produto", width: 1080, height: 1080, clientId: realClient, document: doc }),
    );
    const ai = { mode: "manual" as const, provider: "openai", model: "gpt-image-1" };
    const prepared = await as(real.actor, (s) =>
      prepareDesignImage(s, { designId: id, objectId: "img1", instruction: "fundo de estúdio", ai }),
    );
    expect(prepared).toMatchObject({ demo: false, providerId: "openai" });
    const output = await prepared.run();
    const call = mock.generationCalls().find((c) => c.url.endsWith("/v1/images/edits"));
    expect(call?.form?.get("model")).toBe("gpt-image-1");
    expect(call?.form?.get("prompt")).toBe("fundo de estúdio");
    const sent = call?.form?.get("image");
    expect(sent instanceof Blob && sent.size).toBeGreaterThan(0);
    const edited = await as(real.actor, (s) => saveDesignImage(s, prepared, output, 50));
    expect(edited.demo).toBe(false);

    // Indisponível: o erro chega como erro e nenhum arquivo é criado.
    mock.state.failStatus = 503;
    const count = async () => as(real.actor, async (s) => (await s.db.select().from(files)).length);
    const before = await count();
    const again = await as(real.actor, (s) =>
      prepareDesignImage(s, { designId: id, objectId: "img1", instruction: "fundo azul", ai }),
    );
    await expect(again.run()).rejects.toBeInstanceOf(AiProviderError);
    expect(await count()).toBe(before);

    // Modelo de texto não edita imagem: o erro explica e oferece alternativas.
    await expect(
      as(real.actor, (s) =>
        prepareDesignImage(s, {
          designId: id,
          objectId: "img1",
          instruction: "fundo azul",
          ai: { mode: "manual", provider: "anthropic", model: "claude-sonnet-5-5" },
        }),
      ),
    ).rejects.toBeInstanceOf(ModelSelectionError);
  });

  it("provedor de texto real: monta o contexto da arte e da marca; falha fica registrada como erro", async () => {
    const { id } = await as(real.actor, (s) =>
      createDesign(s, {
        name: "Real",
        width: 1080,
        height: 1080,
        clientId: realClient,
        document: { ...carousel(), meta: { carousel: true, generator: GENERATOR } },
      }),
    );
    mock.state.reply = JSON.stringify({
      reply: "Troquei o título.",
      ops: JSON.stringify([{ op: "setText", id: "t1", text: "Promoção imperdível" }]),
      actions: "[]",
      question: "",
    });
    const raw = { ...carousel(), meta: { carousel: true, generator: GENERATOR } };
    const { result, prepared } = await ask(real.actor, {
      designId: id,
      message: "Corrija o título",
      pageId: "p1",
      document: raw,
    });
    expect(prepared.generation.demo).toBe(false);
    expect(prepared.generation.prompt).toContain('"activePage":1');
    // Plano do gerador de carrosséis (roteiro e direção de arte) vai no contexto.
    expect(prepared.generation.prompt).toContain('"generator":{"v":1');
    expect(prepared.generation.prompt).toContain('"title":"Dica"');
    expect(prepared.generation.system).toContain("image_edit:");
    expect(result.ops).toEqual([{ op: "setText", id: "t1", text: "Promoção imperdível" }]);
    const body = mock.generationCalls().find((c) => c.url.includes("anthropic"))?.body;
    expect(JSON.stringify(body)).toContain("Promocao imperdivel"); // o texto da arte foi ao provedor
    expect(JSON.stringify(body)).not.toContain("Café Aurora"); // dados de outra organização, nunca

    mock.reset();
    mock.state.failStatus = 503;
    await expect(ask(real.actor, { designId: id, message: "Corrija o título", pageId: "p1" })).rejects.toBeInstanceOf(
      AiProviderError,
    );
    const errors = await as(real.actor, (s) =>
      s.db
        .select()
        .from(aiUsage)
        .where(and(eq(aiUsage.operation, "design_edit"), eq(aiUsage.status, "error"))),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("política, permissões e isolamento: sem dados de cliente sem autorização e sem editar o que não pode", async () => {
    await as(real.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    const { id } = await as(real.actor, (s) =>
      createDesign(s, { name: "Sigilosa", width: 1080, height: 1080, clientId: realClient, document: carousel() }),
    );
    await expect(as(real.actor, (s) => prepareDesignAi(s, { designId: id, message: "Corrija" }))).rejects.toThrow(
      POLICY_MESSAGE,
    );
    // Arte sem cliente segue permitida.
    const free = await as(real.actor, (s) => createDesign(s, { name: "Livre", width: 1080, height: 1080 }));
    await expect(
      as(real.actor, (s) => prepareDesignAi(s, { designId: free.id, message: "Corrija" })),
    ).resolves.toBeTruthy();

    // Atendimento usa IA, mas não edita artes; Financeiro não usa nenhum dos dois.
    const account = await addMember(real.org.slug, real.org.id, "account");
    const finance = await addMember(real.org.slug, real.org.id, "finance");
    await expect(
      as(account, (s) => prepareDesignAi(s, { designId: free.id, message: "Corrija" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await as(account, (s) => designAiSetup(s, free.id))).toMatchObject({ canUse: true, canEdit: false });
    await expect(
      as(account, (s) => prepareDesignImage(s, { designId: free.id, objectId: "x", instruction: "nova" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      as(finance, (s) => prepareDesignAi(s, { designId: free.id, message: "Corrija" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Arte de outra organização não existe para quem está fora dela.
    await expect(
      as(demo.actor, (s) => prepareDesignAi(s, { designId: free.id, message: "Corrija" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("histórico da conversa por arte, com o desfecho de cada proposta", async () => {
    const { id } = await as(demo.actor, (s) =>
      createDesign(s, { name: "Histórico", width: 1080, height: 1080, document: carousel() }),
    );
    const other = await as(demo.actor, (s) => createDesign(s, { name: "Outra", width: 1080, height: 1080 }));
    const a = await ask(demo.actor, { designId: id, message: "Corrija os erros de português" });
    await ask(demo.actor, { designId: id, message: "Aumente o título" });
    await ask(demo.actor, { designId: other.id, message: "Corrija os erros de português" });
    await as(demo.actor, (s) => setDesignAiOutcome(s, { generationId: a.generationId, outcome: "applied" }));
    const history = await as(demo.actor, (s) => listDesignAiHistory(s, id));
    expect(history.map((h) => [h.message, h.outcome])).toEqual([
      ["Corrija os erros de português", "applied"],
      ["Aumente o título", null],
    ]);
    expect(history[0]!.reply).toMatch(/corrigi 2 texto/);
    // Só quem fez o pedido marca o desfecho.
    const designer = await addMember(demo.org.slug, demo.org.id, "designer");
    await expect(
      as(designer, (s) => setDesignAiOutcome(s, { generationId: a.generationId, outcome: "undone" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
