import Anthropic from "@anthropic-ai/sdk";
import type { AiModelInfo, Capability, ModelKind, ModelTier } from "@/lib/ai-tasks";
import { env } from "@/server/env";
import { priceOf } from "./pricing";
import { createAnthropicProvider } from "./providers/anthropic";
import { createDemoProvider } from "./providers/demo";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAiProvider, generateOpenAiImage } from "./providers/openai";
import { AiProviderError, type AiProvider, type AiProviderId, type ImageRequest, type ImageResult } from "./types";

/*
 * Registro de provedores de IA. Cada integração declara o que faz (tipos de
 * modelo, parâmetros suportados, limites) e descobre os modelos disponíveis
 * pela API oficial do próprio provedor — nenhum nome de modelo é inventado.
 * Capacidades sem confirmação do provedor ficam como "unknown".
 */

export type ProviderDef = {
  id: AiProviderId;
  label: string;
  /** Tipos de modelo que a integração atende nesta versão. */
  kinds: ModelKind[];
  /** Precisa de chave de API (o modo demonstração não precisa). */
  needsKey: boolean;
  /** Chave definida no servidor (variável de ambiente). */
  envKey: () => string | undefined;
  /** Habilitado sem configuração da organização (sem chave, só por opção explícita do servidor). */
  defaultEnabled?: () => boolean;
  /** Parâmetros que a plataforma envia a este provedor. */
  params: string[];
  /** Limites e observações exibidos na administração. */
  notes: string[];
  /** Lista os modelos disponíveis para a chave (também valida a credencial). */
  listModels: (apiKey: string, signal?: AbortSignal) => Promise<AiModelInfo[]>;
  /** Cliente de texto. */
  text?: (apiKey: string) => AiProvider;
  /** Geração de imagem, quando implementada e confirmada pela documentação oficial. */
  image?: (apiKey: string, req: ImageRequest) => Promise<ImageResult>;
};

function cap(v: boolean | null | undefined): Capability {
  return v === true ? "yes" : v === false ? "no" : "unknown";
}

function model(
  p: AiProviderId,
  id: string,
  m: Partial<Omit<AiModelInfo, "id" | "provider">> & { caps: AiModelInfo["caps"]; kind: ModelKind },
): AiModelInfo {
  return {
    id,
    provider: p,
    label: m.label ?? id,
    kind: m.kind,
    caps: m.caps,
    tier: m.tier ?? "unknown",
    tierSource: m.tierSource ?? "desconhecida",
    maxInputTokens: m.maxInputTokens ?? null,
    maxOutputTokens: m.maxOutputTokens ?? null,
    createdAt: m.createdAt ?? null,
    deprecated: m.deprecated ?? false,
    price: m.price ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Anthropic: GET /v1/models (SDK) informa capacidades e ciclo de vida  */
/* ------------------------------------------------------------------ */

const LINE_TIER: Record<string, ModelTier> = {
  haiku: "fast",
  sonnet: "balanced",
  opus: "quality",
  fable: "quality",
  mythos: "quality",
};

async function listAnthropic(apiKey: string, signal?: AbortSignal): Promise<AiModelInfo[]> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
  const out: AiModelInfo[] = [];
  try {
    for await (const m of client.models.list({ limit: 100 }, { signal })) {
      if (m.lifecycle === "retired") continue;
      const c = m.capabilities;
      out.push(
        model("anthropic", m.id, {
          label: m.display_name || m.id,
          kind: "text",
          caps: {
            text: "yes",
            imageInput: c ? cap(c.image_input.supported) : "unknown",
            imageOutput: "no",
            structured: c ? cap(c.structured_outputs.supported) : "unknown",
            effort: c ? cap(c.effort.supported) : "unknown",
          },
          tier: m.line ? (LINE_TIER[m.line] ?? "unknown") : "unknown",
          tierSource: m.line ? "api" : "desconhecida",
          maxInputTokens: m.max_input_tokens,
          maxOutputTokens: m.max_tokens,
          createdAt: m.created_at,
          deprecated: m.lifecycle === "deprecated",
          price: priceOf(m.id),
        }),
      );
    }
  } catch (err) {
    throw anthropicError(err);
  }
  return out;
}

function anthropicError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError("Chave de API da Anthropic inválida ou sem permissão.", "auth");
  }
  if (err instanceof Anthropic.RateLimitError)
    return new AiProviderError("Limite de requisições da Anthropic atingido.", "rate_limit");
  if (err instanceof Anthropic.APIError)
    return new AiProviderError(`Erro da Anthropic (${err.status ?? "?"}).`, "unavailable");
  if (err instanceof AiProviderError) return err;
  return new AiProviderError("Não foi possível falar com a Anthropic.", "unavailable");
}

/* ------------------------------------------------------------------ */
/* OpenAI: GET /v1/models só informa ids; capacidades por regras claras */
/* ------------------------------------------------------------------ */

const OPENAI_EXCLUDE =
  /(audio|realtime|transcribe|tts|search|embedding|moderation|instruct|codex|computer|whisper|davinci|babbage|dall-e)/;

export function classifyOpenAiModel(id: string): AiModelInfo | null {
  // Modelos de imagem da Images API (documentados no SDK oficial: gpt-image-*, chatgpt-image-latest).
  if (/^(gpt-image|chatgpt-image)/.test(id)) {
    return model("openai", id, {
      kind: "image",
      caps: { text: "no", imageInput: "unknown", imageOutput: "yes", structured: "no", effort: "no" },
      tier: /mini/.test(id) ? "fast" : "quality",
      tierSource: "nome",
      price: null,
    });
  }
  if (!/^(gpt-|chatgpt-|o\d)/.test(id) || OPENAI_EXCLUDE.test(id)) return null;
  return model("openai", id, {
    kind: "text",
    // A listagem não informa entrada de imagem nem JSON: ficam como não confirmados.
    caps: { text: "yes", imageInput: "unknown", imageOutput: "no", structured: "unknown", effort: "no" },
    tier: /-(nano|mini)\b/.test(id) || /-(nano|mini)-/.test(id) ? "fast" : "quality",
    tierSource: "nome",
  });
}

async function listOpenAi(apiKey: string, signal?: AbortSignal): Promise<AiModelInfo[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    signal,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) throw new AiProviderError("Chave de API da OpenAI inválida.", "auth");
  if (res.status === 429) throw new AiProviderError("Limite de requisições da OpenAI atingido.", "rate_limit");
  if (!res.ok) throw new AiProviderError(`Erro da OpenAI (${res.status}).`, "unavailable");
  const data = (await res.json()) as { data?: { id: string; created?: number; shutdown_date?: string | null }[] };
  const now = Date.now();
  return (data.data ?? [])
    .filter((m) => !m.shutdown_date || Date.parse(m.shutdown_date) > now)
    .map((m) => {
      const info = classifyOpenAiModel(m.id);
      if (!info) return null;
      return {
        ...info,
        createdAt: m.created ? new Date(m.created * 1000).toISOString() : null,
        deprecated: !!m.shutdown_date,
      };
    })
    .filter((m): m is AiModelInfo => !!m);
}

/* ------------------------------------------------------------------ */
/* Gemini: GET v1beta/models informa métodos e limites de tokens        */
/* ------------------------------------------------------------------ */

const GEMINI_EXCLUDE = /(embedding|aqa|tts|audio|live|image|imagen|veo|robotics|computer-use|learnlm)/;

export function classifyGeminiModel(m: {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}): AiModelInfo | null {
  const id = m.name.replace(/^models\//, "");
  if (!m.supportedGenerationMethods?.includes("generateContent") || GEMINI_EXCLUDE.test(id)) return null;
  return model("gemini", id, {
    label: m.displayName || id,
    kind: "text",
    // generateContent com responseMimeType JSON (já usado pelo provedor); entrada de imagem não é informada pela listagem.
    caps: { text: "yes", imageInput: "unknown", imageOutput: "no", structured: "yes", effort: "no" },
    tier: /flash-lite/.test(id) ? "fast" : /flash/.test(id) ? "balanced" : /pro/.test(id) ? "quality" : "unknown",
    tierSource: /flash|pro/.test(id) ? "nome" : "desconhecida",
    maxInputTokens: m.inputTokenLimit ?? null,
    maxOutputTokens: m.outputTokenLimit ?? null,
  });
}

async function listGemini(apiKey: string, signal?: AbortSignal): Promise<AiModelInfo[]> {
  const out: AiModelInfo[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ pageSize: "200", ...(pageToken ? { pageToken } : {}) });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${qs}`, {
      signal,
      headers: { "x-goog-api-key": apiKey },
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new AiProviderError("Chave de API do Gemini inválida ou sem permissão.", "auth");
    }
    if (res.status === 429) throw new AiProviderError("Limite de uso do Gemini atingido.", "rate_limit");
    if (!res.ok) throw new AiProviderError(`Erro do Gemini (${res.status}).`, "unavailable");
    const data = (await res.json()) as {
      models?: Parameters<typeof classifyGeminiModel>[0][];
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      const info = classifyGeminiModel(m);
      if (info) out.push(info);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Demonstração (local, sem IA real, desativada por padrão)             */
/* ------------------------------------------------------------------ */

export const DEMO_MODEL: AiModelInfo = model("demo", "demo", {
  label: "Modelo de exemplo",
  kind: "text",
  caps: { text: "yes", imageInput: "no", imageOutput: "no", structured: "yes", effort: "no" },
  tier: "fast",
  tierSource: "desconhecida",
  price: { input: 0, output: 0 },
});

export const PROVIDERS: Record<AiProviderId, ProviderDef> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kinds: ["text"],
    needsKey: true,
    envKey: () => env.ANTHROPIC_API_KEY,
    params: [
      "max_tokens",
      "effort (quando o modelo suporta)",
      "saída estruturada (quando o modelo suporta)",
      "streaming",
    ],
    notes: [
      "Modelos e capacidades vêm da API de modelos da Anthropic.",
      "Não gera imagens.",
      "Custo estimado pela tabela de preços dos modelos atuais; outros modelos ficam sem custo informado.",
    ],
    listModels: listAnthropic,
    text: createAnthropicProvider,
  },
  openai: {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    kinds: ["text", "image"],
    needsKey: true,
    envKey: () => env.OPENAI_API_KEY,
    params: ["max_completion_tokens", "response_format JSON (pedidos estruturados)", "Images API: size, output_format"],
    notes: [
      "A listagem de modelos da OpenAI não informa capacidades: leitura de imagens e JSON ficam como não confirmados.",
      "Geração de imagens pelos modelos gpt-image da Images API.",
      "Custo não informado (sem tabela de preços cadastrada); tokens são registrados quando a API informa.",
    ],
    listModels: listOpenAi,
    text: createOpenAiProvider,
    image: generateOpenAiImage,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    kinds: ["text"],
    needsKey: true,
    envKey: () => env.GEMINI_API_KEY,
    params: ["maxOutputTokens", "responseMimeType JSON (pedidos estruturados)"],
    notes: [
      "Modelos e limites de tokens vêm da API do Gemini (v1beta/models).",
      "Geração de imagens pelo Gemini ainda não está integrada nesta versão.",
      "Custo não informado (sem tabela de preços cadastrada).",
    ],
    listModels: listGemini,
    text: createGeminiProvider,
  },
  demo: {
    id: "demo",
    label: "Demonstração local (sem IA real)",
    kinds: ["text"],
    needsKey: false,
    envKey: () => undefined,
    // Só com AI_DEFAULT_PROVIDER=demo definido explicitamente no servidor (ex.: desenvolvimento local).
    defaultEnabled: () => env.AI_DEFAULT_PROVIDER === "demo",
    params: [],
    notes: [
      "Respostas de exemplo geradas localmente, sem enviar dados a terceiros e sem custo.",
      "Desativado por padrão. O resultado é sempre identificado como exemplo, nunca como IA real.",
    ],
    listModels: async () => [DEMO_MODEL],
    text: () => createDemoProvider(),
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as AiProviderId[];

export function providerDef(id: string): ProviderDef | null {
  return (PROVIDERS as Record<string, ProviderDef>)[id] ?? null;
}
