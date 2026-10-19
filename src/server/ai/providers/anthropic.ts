import Anthropic from "@anthropic-ai/sdk";
import { isNoCredits, noCreditsError } from "../errors";
import { withSchemaInstruction } from "../json-schema";
import { estimateCostMicros } from "../pricing";
import { AiProviderError, type AiProvider, type GenerateRequest, type GenerateResult } from "../types";

/** Modelos atuais com `effort` e saída estruturada verificados (catálogo oficial). */
const VERIFIED_EFFORT = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];
/** Fallback no servidor (beta server-side-fallback): não disponível para o Haiku 5.5. */
const FALLBACK_OK = ["claude-opus-5-5", "claude-sonnet-5-5"];

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (padrão, mais capaz)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (rápido e econômico)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (alto volume, menor custo)" },
];

/**
 * Provedor Anthropic (API oficial, SDK @anthropic-ai/sdk).
 * - Streaming para não estourar tempo limite em respostas longas.
 * - `fallbacks: "default"`: se os filtros de segurança recusarem o pedido, a
 *   própria API refaz a chamada no modelo recomendado (beta server-side-fallback).
 * - Erros tipados do SDK são traduzidos para mensagens em português.
 */
export function createAnthropicProvider(apiKey: string): AiProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60 * 1000 });

  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    // Só envia parâmetros que o modelo suporta: capacidades vindas da API de
    // modelos; sem essa informação, apenas para os modelos atuais verificados.
    const verified = VERIFIED_EFFORT.includes(req.model);
    const effortOk = req.modelCaps?.effort ? req.modelCaps.effort === "yes" : verified;
    const structuredOk = req.modelCaps?.structured ? req.modelCaps.structured !== "no" : verified;
    const fallbacksSupported = FALLBACK_OK.includes(req.model);
    const outputConfig = {
      ...(effortOk ? { effort: "medium" as const } : {}),
      ...(req.jsonSchema && structuredOk ? { format: { type: "json_schema" as const, schema: req.jsonSchema } } : {}),
    };
    try {
      const stream = client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          // Modelo sem saída estruturada confirmada: o esquema vai por escrito.
          system: req.jsonSchema && !structuredOk ? withSchemaInstruction(req.system, req.jsonSchema) : req.system,
          messages: [
            {
              role: "user",
              content: req.images?.length
                ? [
                    ...req.images.map((img) => ({
                      type: "image" as const,
                      source: { type: "base64" as const, media_type: img.mediaType, data: img.data.toString("base64") },
                    })),
                    { type: "text" as const, text: req.prompt },
                  ]
                : req.prompt,
            },
          ],
          ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
          ...(fallbacksSupported ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: req.signal },
      );
      if (req.onText) stream.on("text", (delta) => req.onText!(delta));
      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new AiProviderError(
          "O provedor recusou este pedido pelas políticas de uso. Reformule o pedido e tente novamente.",
          "refusal",
        );
      }
      const text = message.content
        .filter((b): b is Extract<(typeof message.content)[number], { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const inputTokens = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
      const outputTokens = message.usage.output_tokens;
      return {
        text,
        model: message.model,
        inputTokens,
        outputTokens,
        costMicros: estimateCostMicros(req.model, inputTokens, outputTokens),
        stopReason: message.stop_reason,
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AiProviderError("Chave de API da Anthropic inválida ou sem permissão.", "auth");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new AiProviderError(
          "Limite de requisições do provedor atingido. Aguarde um pouco e tente de novo.",
          "rate_limit",
        );
      }
      if (err instanceof Anthropic.BadRequestError) {
        // Mensagem da API sem o JSON bruto ("400 {...}").
        const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
        if (isNoCredits(detail)) throw noCreditsError("Anthropic (Claude)", "console.anthropic.com → Plans & Billing");
        throw new AiProviderError(`Pedido recusado pelo provedor: ${detail}`, "bad_request");
      }
      if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
        throw new AiProviderError("O provedor de IA está indisponível no momento. Tente novamente.", "unavailable");
      }
      if (err instanceof Anthropic.APIError) {
        throw new AiProviderError(`Erro do provedor (${err.status ?? "?"}).`, "unavailable");
      }
      throw err;
    }
  }

  return {
    id: "anthropic",
    label: "Anthropic (Claude)",
    defaultModel: "claude-opus-5-5",
    models: ANTHROPIC_MODELS,
    generate,
  };
}
