import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DESIGN_SCHEMA, fileSrc, imageObject } from "@/lib/design-doc";
import { imageProviderOptions, MAGNIFIC_ASPECT_RATIOS, nearestNamedRatio } from "@/lib/image-gen";
import { AiProviderError } from "@/server/ai/types";
import { withSystem } from "@/server/db";
import { aiGenerations, aiUsage, fileVersions } from "@/server/db/schema";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { updateAiSettings } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { providerStates, saveProviderKey } from "@/server/services/ai-providers";
import { createClient } from "@/server/services/clients";
import { POLICY_MESSAGE } from "@/server/services/design-ai";
import {
  prepareDesignImageGeneration,
  prepareDesignImageUpscale,
  saveDesignImageGeneration,
  saveDesignImageUpscale,
} from "@/server/services/design-image-gen";
import { createDesign } from "@/server/services/designs";
import { storeUpload } from "@/server/services/files";
import { installAiMock } from "./ai-mocks";
import { as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Magnific (Freepik AI) no Estúdio Criador, com a API oficial simulada (mesmos
 * caminhos, cabeçalhos e formatos de resposta da documentação): validação da
 * chave, geração Mystic (tarefa assíncrona) e Classic (síncrona), referência de
 * composição, ampliação Precision/Creative e os erros. Nenhuma chamada sai da
 * máquina — a validação contra a API real depende de uma chave da Magnific.
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const KEY = "fpk-magnific-teste-0001";
const PROMPT = "Frasco de perfume premium sobre mármore preto";
const magnific = (model: string) => ({ mode: "manual" as const, provider: "magnific", model });

async function png(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    .png()
    .toBuffer();
}

describe("Magnific (Freepik AI) — regras puras", () => {
  it("proporção nomeada mais próxima e opções por modelo", () => {
    expect(nearestNamedRatio({ w: 4, h: 5 }, MAGNIFIC_ASPECT_RATIOS)).toBe("social_post_4_5");
    expect(nearestNamedRatio({ w: 1080, h: 1920 }, MAGNIFIC_ASPECT_RATIOS)).toBe("social_story_9_16");
    expect(nearestNamedRatio({ w: 1, h: 1 }, MAGNIFIC_ASPECT_RATIOS)).toBe("square_1_1");
    expect(nearestNamedRatio({ w: 1920, h: 1080 }, MAGNIFIC_ASPECT_RATIOS)).toBe("widescreen_16_9");
    // Mystic: resolução, 1 imagem por tarefa, referência; Classic: prompt negativo e variações, sem resolução.
    expect(imageProviderOptions("magnific", "mystic")).toMatchObject({
      qualityLabel: "Resolução",
      maxVariations: 1,
      negativePrompt: false,
      references: true,
    });
    expect(Object.keys(imageProviderOptions("magnific", "mystic")!.qualities!)).toEqual(["1k", "2k", "4k"]);
    expect(imageProviderOptions("magnific", "classic-fast")).toMatchObject({
      qualities: null,
      negativePrompt: true,
      references: false,
    });
    // A OpenAI continua igual (opções por modelo não vazam para outros provedores).
    expect(imageProviderOptions("openai", "gpt-image-1")).toMatchObject({ negativePrompt: false, maxVariations: 4 });
  });
});

describe("Magnific (Freepik AI) — serviço do editor", () => {
  let ctx: Ctx;
  let mock: ReturnType<typeof installAiMock>;
  let clientId: string;
  let designId: string;
  let smallVersion: string;
  let smallPng: Buffer;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, magnific: env.MAGNIFIC_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.MAGNIFIC_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.magnific.add(KEY);
    await resetDb();
    ctx = await createOrgWithOwner("Agência Magnific");
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "magnific", KEY))).ok).toBe(true);
    await as(ctx.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Perfumaria Lis" }))).id;
    smallPng = await png(64, 48);
    const small = await as(ctx.actor, (s) =>
      storeUpload(s, { buffer: smallPng, originalName: "pequena.png" }, { clientId, category: "general" }),
    );
    smallVersion = small.versionId;
    const bigPng = await png(400, 300);
    const big = await as(ctx.actor, (s) =>
      storeUpload(s, { buffer: bigPng, originalName: "grande.png" }, { clientId, category: "general" }),
    );
    const image = (id: string, versionId: string, w: number, h: number) =>
      imageObject({
        id,
        name: id,
        src: fileSrc(versionId),
        naturalWidth: w,
        naturalHeight: h,
        x: 0,
        y: 0,
        width: w,
        height: h,
      });
    designId = (
      await as(ctx.actor, (s) =>
        createDesign(s, {
          name: "Arte Magnific",
          width: 1080,
          height: 1350,
          clientId,
          document: {
            schema: DESIGN_SCHEMA,
            meta: {},
            components: [],
            pages: [
              {
                id: "p1",
                name: "Capa",
                width: 1080,
                height: 1350,
                background: "#ffffff",
                objects: [image("i1", smallVersion, 64, 48), image("big", big.versionId, 400, 300)],
              },
            ],
          },
        }),
      )
    ).id;
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.MAGNIFIC_API_KEY = saved.magnific;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("valida a chave numa chamada real (lista de tarefas) e devolve o catálogo oficial, só de imagem", async () => {
    // Revalida agora (o beforeEach limpa as chamadas registradas no beforeAll).
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "magnific", KEY))).ok).toBe(true);
    const state = (await as(ctx.actor, (s) => providerStates(s, { admin: true }))).find((p) => p.id === "magnific")!;
    expect(state).toMatchObject({ status: "valid", ready: true, keySource: "org", kinds: ["image"] });
    expect(state.models.map((m) => m.id)).toEqual([
      "mystic",
      "classic-fast",
      "image-upscaler-precision-v2",
      "image-upscaler",
    ]);
    expect(state.models.every((m) => m.kind === "image" && m.caps.text === "no")).toBe(true);
    const probe = mock.calls.find((c) => c.url.includes("/v1/ai/image-upscaler-precision") && c.method === "GET");
    expect(probe?.headers.get("x-magnific-api-key")).toBe(KEY);

    const other = await createOrgWithOwner("Agência Chave Errada");
    const bad = await as(other.actor, (s) => saveProviderKey(s, "magnific", "fpk-errada"));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/inválida/);
    expect(bad.error).not.toContain("fpk-errada");
  });

  it("Mystic: proporção nomeada, resolução, tarefa consultada até concluir e imagem salva em Arquivos", async () => {
    mock.state.imageSize = "request";
    mock.state.magnificPolls = 2;
    const prepared = await as(ctx.actor, (s) =>
      prepareDesignImageGeneration(s, {
        designId,
        prompt: PROMPT,
        format: "portrait",
        quality: "1k",
        ai: magnific("mystic"),
      }),
    );
    expect(prepared).toMatchObject({ providerId: "magnific", quality: "1k", variations: 1 });
    expect(prepared.model.id).toBe("mystic");
    expect(prepared.size).toEqual({ w: 819, h: 1024 });

    const started = Date.now();
    const out = await prepared.run();
    const create = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/ai/mystic"))!;
    expect(create.headers.get("x-magnific-api-key")).toBe(KEY);
    expect(create.body).toEqual({
      prompt: prepared.finalPrompt,
      aspect_ratio: "social_post_4_5",
      resolution: "1k",
      filter_nsfw: true,
    });
    const polls = mock.calls.filter((c) => c.method === "GET" && /\/v1\/ai\/mystic\/task-1$/.test(c.url));
    expect(polls).toHaveLength(3); // IN_PROGRESS, IN_PROGRESS, COMPLETED
    expect(mock.calls.some((c) => c.url === "https://cdn.magnific.test/task-1.png")).toBe(true);
    expect(out.images).toHaveLength(1);
    expect(out.costMicros).toBeNull();

    const result = await as(ctx.actor, (s) => saveDesignImageGeneration(s, prepared, out, Date.now() - started));
    expect(result.provider).toBe("magnific");
    expect(result.images[0]!.src).toMatch(/^\/api\/files\//);
    expect(result.images[0]!.width / result.images[0]!.height).toBeCloseTo(0.8, 2);
    const [usage] = await withSystem((tx) => tx.select().from(aiUsage).where(eq(aiUsage.provider, "magnific")));
    expect(usage).toMatchObject({ operation: "image_generate", task: "image_generation", costMicros: null });
  });

  it("referência de composição: exige a política de dados do cliente e envia a imagem da arte em base64", async () => {
    const blocked = await as(ctx.actor, (s) =>
      prepareDesignImageGeneration(s, {
        designId,
        prompt: PROMPT,
        ai: magnific("mystic"),
        reference: { objectId: "i1", strength: 60 },
      }),
    ).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(ValidationError);
    expect((blocked as Error).message).toBe(POLICY_MESSAGE);

    await as(ctx.actor, (s) =>
      updateAiSettings(s, { enabled: true, allowClientContext: true, monthlyTokenLimit: 0, userDailyRequestLimit: 0 }),
    );
    const prepared = await as(ctx.actor, (s) =>
      prepareDesignImageGeneration(s, {
        designId,
        prompt: PROMPT,
        ai: magnific("mystic"),
        reference: { objectId: "i1", strength: 60 },
      }),
    );
    expect(prepared.referenceObjectId).toBe("i1");
    await prepared.run();
    const create = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/ai/mystic"))!;
    expect(create.body).toMatchObject({ structure_reference: smallPng.toString("base64"), structure_strength: 60 });

    // Modelo que não aceita referência: recusado antes de chamar a API.
    await expect(
      as(ctx.actor, (s) =>
        prepareDesignImageGeneration(s, {
          designId,
          prompt: PROMPT,
          ai: magnific("classic-fast"),
          reference: { objectId: "i1" },
        }),
      ),
    ).rejects.toThrow(/não aceita imagem de referência/);
  });

  it("Classic rápido: chamada síncrona com instruções negativas, variações e proporção nomeada", async () => {
    const prepared = await as(ctx.actor, (s) =>
      prepareDesignImageGeneration(s, {
        designId,
        prompt: PROMPT,
        format: "landscape",
        variations: 2,
        negativePrompt: "texto e marcas d'água",
        ai: magnific("classic-fast"),
      }),
    );
    expect(prepared.quality).toBeNull();
    const out = await prepared.run();
    const call = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/ai/text-to-image"))!;
    expect(call.body).toMatchObject({
      num_images: 2,
      negative_prompt: "texto e marcas d'água",
      image: { size: "widescreen_16_9" },
      filter_nsfw: true,
    });
    expect(out.images).toHaveLength(2);
    expect(mock.state.magnificTasks.size).toBe(0);
  });

  it("ampliar: fator, limite de megapixels, modelo que não amplia e resultado salvo em Arquivos", async () => {
    // Mystic não amplia: erro de modelo incompatível com alternativas (nunca troca sozinho).
    const wrong = await as(ctx.actor, (s) =>
      prepareDesignImageUpscale(s, { designId, objectId: "i1", scale: 2, ai: magnific("mystic") }),
    ).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(ModelSelectionError);
    expect((wrong as ModelSelectionError).reason).toBe("model_incompatible");
    expect((wrong as ModelSelectionError).alternatives.map((a) => a.model)).toContain("image-upscaler-precision-v2");

    // 400×300 × 16 = 6400×4800 = 30,7 MP: acima do limite documentado (25,3 MP).
    await expect(
      as(ctx.actor, (s) =>
        prepareDesignImageUpscale(s, {
          designId,
          objectId: "big",
          scale: 16,
          ai: magnific("image-upscaler-precision-v2"),
        }),
      ),
    ).rejects.toThrow(/MP/);
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    const prepared = await as(ctx.actor, (s) =>
      prepareDesignImageUpscale(s, {
        designId,
        objectId: "i1",
        scale: 2,
        ai: magnific("image-upscaler-precision-v2"),
      }),
    );
    expect(prepared).toMatchObject({
      objectId: "i1",
      pageId: "p1",
      originalVersionId: smallVersion,
      scale: 2,
      input: { width: 64, height: 48 },
      output: { width: 128, height: 96 },
    });
    const started = Date.now();
    const out = await prepared.run();
    const create = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/ai/image-upscaler-precision-v2"))!;
    expect(create.body).toEqual({ image: smallPng.toString("base64"), scale_factor: 2 });
    const result = await as(ctx.actor, (s) => saveDesignImageUpscale(s, prepared, out, Date.now() - started));
    expect(result).toMatchObject({ provider: "magnific", scale: 2, objectId: "i1", originalVersionId: smallVersion });
    expect(result.image).toMatchObject({ width: 128, height: 96 });
    expect(result.image.src).toBe(fileSrc(result.image.versionId));
    const [version] = await withSystem((tx) =>
      tx.select().from(fileVersions).where(eq(fileVersions.id, result.image.versionId)),
    );
    expect(version?.note).toContain("Ampliada por IA");
    const [gen] = await withSystem((tx) =>
      tx.select().from(aiGenerations).where(eq(aiGenerations.kind, "image_upscale")),
    );
    expect(gen?.provider).toBe("magnific");
    const usage = await withSystem((tx) => tx.select().from(aiUsage).where(eq(aiUsage.operation, "image_upscale")));
    expect(usage.some((u) => u.status === "success" && u.task === "image_upscale")).toBe(true);

    // Creative: fator em "2x", descrição opcional.
    const creative = await as(ctx.actor, (s) =>
      prepareDesignImageUpscale(s, {
        designId,
        objectId: "i1",
        scale: 4,
        prompt: "mais nitidez no rótulo",
        ai: magnific("image-upscaler"),
      }),
    );
    await creative.run();
    const call = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/ai/image-upscaler"))!;
    expect(call.body).toEqual({
      image: smallPng.toString("base64"),
      scale_factor: "4x",
      prompt: "mais nitidez no rótulo",
    });
  });

  it("erros do provedor viram mensagens claras (sem a chave): tarefa falhou, sem créditos, limite e indisponível", async () => {
    const prepared = await as(ctx.actor, (s) =>
      prepareDesignImageGeneration(s, { designId, prompt: PROMPT, ai: magnific("mystic") }),
    );
    mock.state.magnificFinal = "FAILED";
    const failed = await prepared.run().catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(AiProviderError);
    expect((failed as AiProviderError).kind).toBe("unavailable");
    expect((failed as Error).message).toMatch(/não concluiu/);

    mock.reset();
    mock.state.failStatus = 402;
    const credits = await prepared.run().catch((e: unknown) => e);
    expect((credits as AiProviderError).kind).toBe("config");
    expect((credits as Error).message).toMatch(/sem créditos/);

    mock.reset();
    mock.state.failStatus = 429;
    expect(((await prepared.run().catch((e: unknown) => e)) as AiProviderError).kind).toBe("rate_limit");

    mock.reset();
    mock.state.failStatus = 503;
    const down = (await prepared.run().catch((e: unknown) => e)) as AiProviderError;
    expect(down.kind).toBe("unavailable");
    expect(down.message).not.toContain(KEY);
  });
});
