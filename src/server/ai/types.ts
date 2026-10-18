import type { ModelCaps } from "@/lib/ai-tasks";

export type AiProviderId = "anthropic" | "openai" | "gemini" | "demo";

/** Imagem enviada junto com o pedido (só para modelos que leem imagens). */
export type AiImageInput = { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: Buffer };

export type GenerateRequest = {
  model: string;
  system: string;
  prompt: string;
  /** Imagens de referência (ex.: capturas de tela). O texto vai depois das imagens. */
  images?: AiImageInput[];
  maxTokens: number;
  /** Quando definido, pede JSON válido (saída estruturada). */
  jsonSchema?: Record<string, unknown>;
  /** Capacidades conhecidas do modelo escolhido (para enviar só parâmetros suportados). */
  modelCaps?: Partial<ModelCaps>;
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
};

export type GenerateResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Custo estimado em micro-dólares (1e-6 USD) pela tabela de preços; null quando não há dados. */
  costMicros: number | null;
  stopReason: string | null;
};

/** Contrato que todo provedor implementa. Os módulos da plataforma só conhecem esta interface. */
export interface AiProvider {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  models: { id: string; label: string }[];
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limit" | "refusal" | "bad_request" | "unavailable" | "config",
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export type ImageRequest = {
  model: string;
  prompt: string;
  /** Ex.: "1024x1024". */
  size: string;
  signal?: AbortSignal;
};

export type ImageResult = {
  /** Imagens em PNG (bytes). */
  images: Buffer[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
};
