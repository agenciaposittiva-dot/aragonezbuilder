import type { AiModelInfo } from "@/lib/ai-tasks";
import { env } from "@/server/env";
import { isNoCredits, noCreditsError } from "../errors";
import {
  AiProviderError,
  type ImageRequest,
  type ImageResult,
  type ImageUpscaleRequest,
  type ProviderOpts,
} from "../types";

/*
 * Magnific (antiga Freepik AI) — API oficial documentada em docs.magnific.com.
 *
 * - Base: https://api.magnific.com (api.freepik.com continua aceitando a mesma
 *   chave; MAGNIFIC_API_BASE_URL muda o endereço).
 * - Autenticação: cabeçalho `x-magnific-api-key`. A documentação com a marca
 *   Freepik usa `x-freepik-api-key` para a mesma chave; enviamos os dois.
 * - Endpoints usados (referência oficial):
 *     POST /v1/ai/mystic                      → tarefa; GET /v1/ai/mystic/{task-id}
 *     POST /v1/ai/text-to-image               → Classic rápido, síncrono (base64)
 *     POST /v1/ai/image-upscaler              → Magnific Creative; GET /v1/ai/image-upscaler/{task-id}
 *     POST /v1/ai/image-upscaler-precision-v2 → Magnific Precision v2; GET …/{task-id}
 *     GET  /v1/ai/image-upscaler-precision    → lista de tarefas (só valida a chave)
 * - Tarefas assíncronas: status CREATED → IN_PROGRESS → COMPLETED (ou FAILED);
 *   o resultado vem em `data.generated[]` (URLs temporárias), baixadas aqui.
 * - A API não lista modelos: o catálogo abaixo é o da documentação. Também não
 *   informa créditos consumidos por tarefa: o custo fica "não informado".
 * - Uma assinatura do site não dá acesso à API: a chave vem do painel de API
 *   da Magnific, com créditos próprios.
 */

export const MAGNIFIC_LABEL = "Magnific (Freepik AI)";

export const MAGNIFIC_MODEL = {
  mystic: "mystic",
  classic: "classic-fast",
  precision: "image-upscaler-precision-v2",
  creative: "image-upscaler",
} as const;

/** Fatores de ampliação aceitos (Creative: 2x–16x; Precision v2: inteiro de 2 a 16). */
export const MAGNIFIC_SCALES = [2, 4, 8, 16] as const;
/** Limite documentado do resultado da ampliação (megapixels). */
export const MAGNIFIC_MAX_MEGAPIXELS = 25.3;

/** Tempo máximo de espera por uma tarefa (a rota do editor tem 120 s). */
const POLL_TIMEOUT_MS = 95_000;
const POLL_INTERVAL_MS = 2_500;
const HTTP_TIMEOUT_MS = 30_000;

const base = (baseUrl?: string | null) =>
  (baseUrl || env.MAGNIFIC_API_BASE_URL || "https://api.magnific.com").replace(/\/+$/, "");

function headers(apiKey: string, json = false): Record<string, string> {
  return {
    "x-magnific-api-key": apiKey,
    "x-freepik-api-key": apiKey,
    accept: "application/json",
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

const common = {
  provider: "magnific",
  tierSource: "desconhecida" as const,
  maxInputTokens: null,
  maxOutputTokens: null,
  createdAt: null,
  deprecated: false,
  price: null,
};
const caps = (o: Partial<AiModelInfo["caps"]>): AiModelInfo["caps"] => ({
  text: "no",
  imageInput: "no",
  imageOutput: "no",
  structured: "no",
  effort: "no",
  imageEdit: "no",
  imageUpscale: "no",
  ...o,
});

/** Catálogo (documentação oficial): geração (Mystic, Classic) e ampliação (Precision v2, Creative). */
export const MAGNIFIC_CATALOG: AiModelInfo[] = [
  {
    ...common,
    id: MAGNIFIC_MODEL.mystic,
    label: "Mystic (geração 1K–4K, aceita referências)",
    kind: "image",
    tier: "quality",
    caps: caps({ imageOutput: "yes", imageInput: "yes" }),
  },
  {
    ...common,
    id: MAGNIFIC_MODEL.classic,
    label: "Classic rápido (geração)",
    kind: "image",
    tier: "fast",
    caps: caps({ imageOutput: "yes" }),
  },
  {
    ...common,
    id: MAGNIFIC_MODEL.precision,
    label: "Magnific Precision v2 (ampliar, fiel ao original)",
    kind: "image",
    tier: "quality",
    caps: caps({ imageInput: "yes", imageUpscale: "yes" }),
  },
  {
    ...common,
    id: MAGNIFIC_MODEL.creative,
    label: "Magnific Creative (ampliar com detalhes criativos)",
    kind: "image",
    tier: "quality",
    caps: caps({ imageInput: "yes", imageUpscale: "yes" }),
  },
];

/* ------------------------------------------------------------------ */
/* Erros (nunca incluem a chave)                                       */
/* ------------------------------------------------------------------ */

async function fail(res: Response, what: string): Promise<never> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { message?: string; error?: { message?: string } | string; detail?: string };
      detail = String(j.message ?? (typeof j.error === "string" ? j.error : j.error?.message) ?? j.detail ?? "");
    } catch {
      detail = text;
    }
  } catch {
    detail = "";
  }
  detail = detail.replace(/\s+/g, " ").trim().slice(0, 200);
  if (res.status === 401 || res.status === 403) {
    throw new AiProviderError("Chave de API da Magnific inválida ou sem permissão.", "auth");
  }
  if (res.status === 402 || isNoCredits(detail) || /insufficient|not enough|no credits|sem cr[eé]ditos/i.test(detail)) {
    throw noCreditsError("Magnific", "magnific.com → API → créditos");
  }
  if (res.status === 429) {
    throw new AiProviderError("Limite de requisições da Magnific atingido. Tente de novo em instantes.", "rate_limit");
  }
  if (res.status === 404) {
    throw new AiProviderError(
      `Recurso da Magnific não encontrado ao ${what} (confira o endereço da API e o modelo).`,
      "config",
    );
  }
  if (res.status >= 500) {
    throw new AiProviderError(`Magnific indisponível ao ${what} (${res.status}).`, "unavailable");
  }
  throw new AiProviderError(
    `A Magnific recusou o pedido ao ${what} (${res.status})${detail ? `: ${detail}` : "."}`,
    "bad_request",
  );
}

function withTimeout(signal: AbortSignal | undefined, ms = HTTP_TIMEOUT_MS): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AiProviderError("Operação cancelada.", "bad_request"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AiProviderError("Operação cancelada.", "bad_request"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/* ------------------------------------------------------------------ */
/* Validação da chave                                                  */
/* ------------------------------------------------------------------ */

/**
 * A API não tem listagem de modelos. Validamos a chave com a listagem de
 * tarefas do Precision (GET, documentada) e devolvemos o catálogo oficial.
 */
export async function listMagnificModels(
  apiKey: string,
  signal?: AbortSignal,
  opts?: ProviderOpts,
): Promise<AiModelInfo[]> {
  let res: Response;
  try {
    res = await fetch(`${base(opts?.baseUrl)}/v1/ai/image-upscaler-precision`, {
      signal: withTimeout(signal, 20_000),
      headers: headers(apiKey),
    });
  } catch {
    throw new AiProviderError("Não foi possível falar com a Magnific (rede ou tempo esgotado).", "unavailable");
  }
  if (!res.ok) await fail(res, "validar a chave");
  await res.arrayBuffer().catch(() => undefined);
  return MAGNIFIC_CATALOG;
}

/* ------------------------------------------------------------------ */
/* Tarefas assíncronas                                                 */
/* ------------------------------------------------------------------ */

type TaskData = { task_id?: string; status?: string; generated?: unknown; has_nsfw?: unknown };

function urlsOf(data: TaskData): string[] {
  return Array.isArray(data.generated)
    ? data.generated.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
}

async function createTask(
  apiKey: string,
  baseUrl: string | null | undefined,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  what: string,
): Promise<TaskData> {
  let res: Response;
  try {
    res = await fetch(`${base(baseUrl)}${path}`, {
      method: "POST",
      signal: withTimeout(signal),
      headers: headers(apiKey, true),
      body: JSON.stringify(body),
    });
  } catch {
    if (signal?.aborted) throw new AiProviderError("Operação cancelada.", "bad_request");
    throw new AiProviderError("Não foi possível falar com a Magnific (rede ou tempo esgotado).", "unavailable");
  }
  if (!res.ok) await fail(res, what);
  const json = (await res.json().catch(() => ({}))) as { data?: TaskData };
  const data = json.data ?? {};
  if (!data.task_id && !urlsOf(data).length) {
    throw new AiProviderError(`A Magnific não devolveu uma tarefa ao ${what}.`, "unavailable");
  }
  return data;
}

async function pollTask(
  apiKey: string,
  baseUrl: string | null | undefined,
  path: string,
  taskId: string,
  signal: AbortSignal | undefined,
  what: string,
): Promise<string[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${base(baseUrl)}${path}/${encodeURIComponent(taskId)}`, {
        signal: withTimeout(signal),
        headers: headers(apiKey),
      });
    } catch {
      if (signal?.aborted) throw new AiProviderError("Operação cancelada.", "bad_request");
      throw new AiProviderError(
        "Não foi possível consultar a tarefa na Magnific (rede ou tempo esgotado).",
        "unavailable",
      );
    }
    if (!res.ok) await fail(res, `consultar a tarefa ao ${what}`);
    const data = ((await res.json().catch(() => ({}))) as { data?: TaskData }).data ?? {};
    const status = String(data.status ?? "").toUpperCase();
    if (status === "COMPLETED") {
      const urls = urlsOf(data);
      if (!urls.length) throw new AiProviderError("A Magnific concluiu a tarefa sem devolver imagem.", "unavailable");
      return urls;
    }
    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED" || status === "CANCELED") {
      throw new AiProviderError(
        `A Magnific não concluiu a tarefa (${status}). Tente de novo ou mude as opções.`,
        "unavailable",
      );
    }
    if (Date.now() >= deadline) {
      throw new AiProviderError(
        "A Magnific ainda está processando e o tempo de espera acabou. Os créditos podem ter sido consumidos; tente de novo com menos resolução ou ampliação.",
        "unavailable",
      );
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
}

async function download(urls: string[], signal?: AbortSignal): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url, { signal: withTimeout(signal, 60_000) });
    } catch {
      throw new AiProviderError("Não foi possível baixar a imagem gerada pela Magnific.", "unavailable");
    }
    if (!res.ok) throw new AiProviderError(`Não foi possível baixar a imagem gerada (${res.status}).`, "unavailable");
    out.push(Buffer.from(await res.arrayBuffer()));
  }
  return out;
}

async function runTask(
  apiKey: string,
  baseUrl: string | null | undefined,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  what: string,
): Promise<Buffer[]> {
  const created = await createTask(apiKey, baseUrl, path, body, signal, what);
  const direct = urlsOf(created);
  const urls =
    String(created.status ?? "").toUpperCase() === "COMPLETED" && direct.length
      ? direct
      : await pollTask(apiKey, baseUrl, path, String(created.task_id), signal, what);
  return download(urls, signal);
}

/* ------------------------------------------------------------------ */
/* Geração                                                             */
/* ------------------------------------------------------------------ */

const MYSTIC_RESOLUTIONS = new Set(["1k", "2k", "4k"]);

/** Classic rápido: POST /v1/ai/text-to-image (síncrono, base64). */
async function classicFast(apiKey: string, req: ImageRequest): Promise<ImageResult> {
  const n = Math.max(1, Math.round(req.n ?? 1));
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    num_images: n,
    image: { size: req.aspectRatio ?? "square_1_1" },
    filter_nsfw: true,
  };
  const negative = req.negativePrompt?.trim();
  if (negative && negative.length >= 3) body.negative_prompt = negative;
  let res: Response;
  try {
    res = await fetch(`${base(req.baseUrl)}/v1/ai/text-to-image`, {
      method: "POST",
      signal: withTimeout(req.signal, 90_000),
      headers: headers(apiKey, true),
      body: JSON.stringify(body),
    });
  } catch {
    if (req.signal?.aborted) throw new AiProviderError("Operação cancelada.", "bad_request");
    throw new AiProviderError("Não foi possível falar com a Magnific (rede ou tempo esgotado).", "unavailable");
  }
  if (!res.ok) await fail(res, "gerar a imagem");
  const json = (await res.json().catch(() => ({}))) as { data?: { base64?: string }[] };
  const images = (json.data ?? [])
    .map((d) => d.base64)
    .filter((b): b is string => typeof b === "string" && b.length > 0)
    .map((b) => Buffer.from(b, "base64"));
  if (!images.length) throw new AiProviderError("A Magnific não devolveu nenhuma imagem.", "unavailable");
  return { images, model: req.model, inputTokens: null, outputTokens: null, costMicros: null };
}

/**
 * Geração: Mystic (tarefa assíncrona, 1 imagem por tarefa, com referências
 * opcionais de estrutura/estilo) ou Classic rápido (síncrono).
 */
export async function generateMagnificImage(apiKey: string, req: ImageRequest): Promise<ImageResult> {
  if (req.model === MAGNIFIC_MODEL.classic) return classicFast(apiKey, req);
  if (req.model !== MAGNIFIC_MODEL.mystic) {
    throw new AiProviderError(`O modelo ${req.model} da Magnific não gera imagens a partir de texto.`, "config");
  }
  const resolution = req.resolution && MYSTIC_RESOLUTIONS.has(req.resolution) ? req.resolution : "2k";
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    aspect_ratio: req.aspectRatio ?? "square_1_1",
    resolution,
    filter_nsfw: true,
  };
  if (req.references?.structure) {
    body.structure_reference = req.references.structure.toString("base64");
    if (typeof req.references.structureStrength === "number") {
      body.structure_strength = Math.max(0, Math.min(100, Math.round(req.references.structureStrength)));
    }
  }
  if (req.references?.style) {
    body.style_reference = req.references.style.toString("base64");
    if (typeof req.references.adherence === "number") {
      body.adherence = Math.max(0, Math.min(100, Math.round(req.references.adherence)));
    }
  }
  const n = Math.max(1, Math.round(req.n ?? 1));
  const images: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    images.push(...(await runTask(apiKey, req.baseUrl, "/v1/ai/mystic", body, req.signal, "gerar a imagem")));
  }
  return { images, model: req.model, inputTokens: null, outputTokens: null, costMicros: null };
}

/* ------------------------------------------------------------------ */
/* Ampliação (upscale)                                                 */
/* ------------------------------------------------------------------ */

const CREATIVE_OPTIMIZED = new Set([
  "standard",
  "soft_portraits",
  "hard_portraits",
  "art_n_illustration",
  "videogame_assets",
  "nature_n_landscapes",
  "films_n_photography",
  "3d_renders",
  "science_fiction_n_horror",
]);
const ENGINES = new Set(["automatic", "magnific_illusio", "magnific_sharpy", "magnific_sparkle"]);
const FLAVORS = new Set(["sublime", "photo", "photo_denoiser"]);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));

/** Ampliação: Precision v2 (fiel) ou Creative (detalhes guiados por descrição). */
export async function upscaleMagnificImage(apiKey: string, req: ImageUpscaleRequest): Promise<ImageResult> {
  const scale = (MAGNIFIC_SCALES as readonly number[]).includes(req.scale) ? req.scale : 2;
  const image = req.image.toString("base64");
  if (req.model === MAGNIFIC_MODEL.precision) {
    const body: Record<string, unknown> = { image, scale_factor: scale };
    if (req.flavor && FLAVORS.has(req.flavor)) body.flavor = req.flavor;
    if (typeof req.sharpen === "number") body.sharpen = clamp(req.sharpen, 0, 100);
    if (typeof req.smartGrain === "number") body.smart_grain = clamp(req.smartGrain, 0, 100);
    if (typeof req.ultraDetail === "number") body.ultra_detail = clamp(req.ultraDetail, 0, 100);
    const images = await runTask(
      apiKey,
      req.baseUrl,
      "/v1/ai/image-upscaler-precision-v2",
      body,
      req.signal,
      "ampliar a imagem",
    );
    return { images, model: req.model, inputTokens: null, outputTokens: null, costMicros: null };
  }
  if (req.model === MAGNIFIC_MODEL.creative) {
    const body: Record<string, unknown> = { image, scale_factor: `${scale}x` };
    if (req.optimizedFor && CREATIVE_OPTIMIZED.has(req.optimizedFor)) body.optimized_for = req.optimizedFor;
    if (req.prompt?.trim()) body.prompt = req.prompt.trim().slice(0, 2000);
    if (typeof req.creativity === "number") body.creativity = clamp(req.creativity, -10, 10);
    if (typeof req.hdr === "number") body.hdr = clamp(req.hdr, -10, 10);
    if (typeof req.resemblance === "number") body.resemblance = clamp(req.resemblance, -10, 10);
    if (typeof req.fractality === "number") body.fractality = clamp(req.fractality, -10, 10);
    if (req.engine && ENGINES.has(req.engine)) body.engine = req.engine;
    const images = await runTask(apiKey, req.baseUrl, "/v1/ai/image-upscaler", body, req.signal, "ampliar a imagem");
    return { images, model: req.model, inputTokens: null, outputTokens: null, costMicros: null };
  }
  throw new AiProviderError(`O modelo ${req.model} da Magnific não amplia imagens.`, "config");
}
