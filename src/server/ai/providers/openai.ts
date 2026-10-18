import { AiProviderError, type AiProvider, type GenerateRequest, type GenerateResult } from "../types";

/**
 * Provedor OpenAI pela API oficial (Chat Completions, REST). O modelo é
 * escolhido pela organização nas configurações. O custo não é estimado
 * (sem tabela de preços cadastrada); os tokens informados são registrados.
 */
export function createOpenAiProvider(apiKey: string): AiProvider {
  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!req.model) throw new AiProviderError("Defina o modelo da OpenAI nas configurações de IA.", "config");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model,
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
  return { id: "openai", label: "OpenAI", defaultModel: "", models: [], generate };
}
