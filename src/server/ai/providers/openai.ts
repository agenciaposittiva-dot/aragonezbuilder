import {
  AiProviderError,
  type AiProvider,
  type GenerateRequest,
  type GenerateResult,
  type ImageEditRequest,
  type ImageRequest,
  type ImageResult,
} from "../types";

/** Modelos disponíveis para a chave (cache por processo, 1 hora). */
let modelCache: { key: string; at: number; models: string[] } | null = null;

async function listModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  if (modelCache && modelCache.key === apiKey && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  const res = await fetch("https://api.openai.com/v1/models", {
    signal,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) throw new AiProviderError("Chave de API da OpenAI inválida.", "auth");
  if (!res.ok) throw new AiProviderError(`Erro da OpenAI (${res.status}).`, "unavailable");
  const data = (await res.json()) as { data?: { id: string }[] };
  const models = (data.data ?? []).map((m) => m.id);
  modelCache = { key: apiKey, at: Date.now(), models };
  return models;
}

/**
 * Sem modelo definido, usa o GPT principal de versão mais alta disponível para
 * a chave (ex.: "gpt-5.1" antes de "gpt-5"); na falta dele, a variante "mini".
 */
export function pickDefaultOpenAiModel(models: string[]): string | null {
  const version = (id: string) => Number(/^gpt-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const main = models.filter((m) => /^gpt-\d+(\.\d+)?$/.test(m));
  const mini = models.filter((m) => /^gpt-\d+(\.\d+)?-mini$/.test(m));
  const pool = main.length ? main : mini;
  return pool.sort((a, b) => version(b) - version(a))[0] ?? null;
}

/**
 * Provedor OpenAI (ChatGPT) pela API oficial (Chat Completions, REST). O modelo
 * é escolhido pela organização ou detectado automaticamente. O custo não é estimado
 * (sem tabela de preços cadastrada); os tokens informados são registrados.
 */
export function createOpenAiProvider(apiKey: string): AiProvider {
  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    let model = req.model;
    if (!model) {
      model = pickDefaultOpenAiModel(await listModels(apiKey, req.signal)) ?? "";
      if (!model) throw new AiProviderError("Defina o modelo da OpenAI nas configurações de IA.", "config");
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          {
            role: "user",
            content: req.images?.length
              ? [
                  ...req.images.map((img) => ({
                    type: "image_url",
                    image_url: { url: `data:${img.mime};base64,${img.data.toString("base64")}` },
                  })),
                  { type: "text", text: req.prompt },
                ]
              : req.prompt,
          },
        ],
        ...(req.jsonSchema ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (res.status === 401 || res.status === 403) throw new AiProviderError("Chave de API da OpenAI inválida.", "auth");
    if (res.status === 429) throw new AiProviderError("Limite de requisições da OpenAI atingido.", "rate_limit");
    if (!res.ok)
      throw new AiProviderError(`Erro da OpenAI (${res.status}).`, res.status >= 500 ? "unavailable" : "bad_request");
    const data = (await res.json()) as {
      model: string;
      choices: { message: { content: string | null }; finish_reason: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices[0]?.message.content ?? "";
    req.onText?.(text);
    return {
      text,
      model: data.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      costMicros: null,
      stopReason: data.choices[0]?.finish_reason ?? null,
    };
  }
  return { id: "openai", label: "OpenAI (ChatGPT)", defaultModel: "", models: [], generate };
}

/**
 * Geração de imagem pela Images API oficial (POST /v1/images/generations).
 * Os modelos gpt-image sempre devolvem a imagem em base64; o uso de tokens só
 * vem para alguns modelos. Custo não estimado (sem tabela de preços).
 */
export async function generateOpenAiImage(apiKey: string, req: ImageRequest): Promise<ImageResult> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: req.signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: req.model, prompt: req.prompt, size: req.size, n: 1, output_format: "png" }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? "";
    if (res.status === 401 || res.status === 403) throw new AiProviderError("Chave de API da OpenAI inválida.", "auth");
    if (res.status === 429) throw new AiProviderError("Limite de requisições da OpenAI atingido.", "rate_limit");
    if (/moderation|content_policy|safety/i.test(code)) {
      throw new AiProviderError(
        "A OpenAI recusou o pedido de imagem pelas políticas de uso. Reformule a descrição.",
        "refusal",
      );
    }
    if (res.status === 404)
      throw new AiProviderError("Modelo de imagem da OpenAI não encontrado para esta chave.", "config");
    throw new AiProviderError(
      `Erro da OpenAI ao gerar a imagem (${res.status}).`,
      res.status >= 500 ? "unavailable" : "bad_request",
    );
  }
  const data = (await res.json()) as {
    data?: { b64_json?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const images = (data.data ?? [])
    .map((d) => d.b64_json)
    .filter((b): b is string => !!b)
    .map((b) => Buffer.from(b, "base64"));
  if (!images.length) throw new AiProviderError("A OpenAI não devolveu nenhuma imagem.", "unavailable");
  return {
    images,
    model: req.model,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
    costMicros: null,
  };
}

/**
 * Edição de imagem pela Images API oficial (POST /v1/images/edits): a imagem
 * original vai como arquivo de referência junto com a instrução. Os modelos
 * gpt-image devolvem a imagem em base64. O resultado é uma imagem nova; a
 * original não é alterada.
 */
export async function editOpenAiImage(apiKey: string, req: ImageEditRequest): Promise<ImageResult> {
  const form = new FormData();
  form.set("model", req.model);
  form.set("prompt", req.prompt);
  form.set("n", "1");
  if (req.size && req.size !== "auto") form.set("size", req.size);
  const ext = req.mimeType === "image/jpeg" ? "jpg" : req.mimeType === "image/webp" ? "webp" : "png";
  form.set("image", new Blob([new Uint8Array(req.image)], { type: req.mimeType }), `original.${ext}`);
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    signal: req.signal,
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? "";
    if (res.status === 401 || res.status === 403) throw new AiProviderError("Chave de API da OpenAI inválida.", "auth");
    if (res.status === 429) throw new AiProviderError("Limite de requisições da OpenAI atingido.", "rate_limit");
    if (/moderation|content_policy|safety/i.test(code)) {
      throw new AiProviderError(
        "A OpenAI recusou a edição pelas políticas de uso. Reformule o pedido ou use outra imagem.",
        "refusal",
      );
    }
    if (res.status === 404)
      throw new AiProviderError("Modelo de imagem da OpenAI não encontrado para esta chave.", "config");
    throw new AiProviderError(
      `Erro da OpenAI ao editar a imagem (${res.status}).`,
      res.status >= 500 ? "unavailable" : "bad_request",
    );
  }
  const data = (await res.json()) as {
    data?: { b64_json?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const images = (data.data ?? [])
    .map((d) => d.b64_json)
    .filter((b): b is string => !!b)
    .map((b) => Buffer.from(b, "base64"));
  if (!images.length) throw new AiProviderError("A OpenAI não devolveu nenhuma imagem editada.", "unavailable");
  return {
    images,
    model: req.model,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
    costMicros: null,
  };
}
