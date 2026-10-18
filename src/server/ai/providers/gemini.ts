import { AiProviderError, type AiProvider, type GenerateRequest, type GenerateResult } from "../types";

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Modelos disponíveis para a chave (cache por processo, 1 hora). */
let modelCache: { key: string; at: number; models: string[] } | null = null;

async function listModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  if (modelCache && modelCache.key === apiKey && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  const res = await fetch(`${API}/models?pageSize=200`, { signal, headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) throw errorFor(res.status);
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const models = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  modelCache = { key: apiKey, at: Date.now(), models };
  return models;
}

/**
 * Os identificadores do Gemini mudam com frequência (prévias são desligadas).
 * Sem modelo definido, usa o "flash" estável de versão mais alta disponível.
 */
export function pickDefaultModel(models: string[]): string | null {
  const version = (id: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const stableFlash = models.filter((m) => /^gemini-\d+(\.\d+)?-flash$/.test(m));
  const anyFlash = models.filter((m) => /^gemini-.*flash/.test(m) && !/(image|tts|audio|live|embedding)/.test(m));
  const pool = stableFlash.length ? stableFlash : anyFlash;
  return pool.sort((a, b) => version(b) - version(a))[0] ?? null;
}

function errorFor(status: number) {
  if (status === 400)
    return new AiProviderError("Requisição recusada pelo Gemini (verifique a chave e o modelo).", "bad_request");
  if (status === 401 || status === 403)
    return new AiProviderError("Chave de API do Gemini inválida ou sem permissão.", "auth");
  if (status === 404)
    return new AiProviderError("Modelo do Gemini não encontrado. Ajuste nas configurações de IA.", "config");
  if (status === 429) return new AiProviderError("Limite de uso do Gemini atingido.", "rate_limit");
  return new AiProviderError(`Erro do Gemini (${status}).`, status >= 500 ? "unavailable" : "bad_request");
}

/**
 * Provedor Google Gemini pela API oficial (generateContent, REST). O custo não
 * é estimado (sem tabela de preços cadastrada); os tokens são registrados.
 */
export function createGeminiProvider(apiKey: string): AiProvider {
  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    let model = req.model;
    if (!model) {
      model = pickDefaultModel(await listModels(apiKey, req.signal)) ?? "";
      if (!model) throw new AiProviderError("Nenhum modelo do Gemini disponível para esta chave.", "config");
    }
    const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          {
            role: "user",
            parts: [
              ...(req.images ?? []).map((img) => ({
                inlineData: { mimeType: img.mediaType, data: img.data.toString("base64") },
              })),
              { text: req.prompt },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          ...(req.jsonSchema ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    if (!res.ok) throw errorFor(res.status);
    const data = (await res.json()) as {
      modelVersion?: string;
      promptFeedback?: { blockReason?: string };
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    if (data.promptFeedback?.blockReason) {
      throw new AiProviderError("O Gemini recusou o pedido por políticas de conteúdo.", "refusal");
    }
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    if (candidate?.finishReason === "SAFETY") {
      throw new AiProviderError("O Gemini interrompeu a resposta por políticas de conteúdo.", "refusal");
    }
    req.onText?.(text);
    const usage = data.usageMetadata ?? {};
    return {
      text,
      model: data.modelVersion ?? model,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      costMicros: null,
      stopReason: candidate?.finishReason ?? null,
    };
  }
  return { id: "gemini", label: "Google Gemini", defaultModel: "", models: [], generate };
}
