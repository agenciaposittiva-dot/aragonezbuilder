import { AiProviderError, type AiProvider, type GenerateRequest, type GenerateResult } from "../types";

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
          { role: "user", content: req.prompt },
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
      costMicros: 0,
      stopReason: data.choices[0]?.finish_reason ?? null,
    };
  }
  return { id: "openai", label: "OpenAI (ChatGPT)", defaultModel: "", models: [], generate };
}
