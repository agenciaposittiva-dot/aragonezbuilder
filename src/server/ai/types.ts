export type AiProviderId = "anthropic" | "openai" | "gemini" | "demo";

export type GenerateRequest = {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Quando definido, pede JSON válido (saída estruturada). */
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
};

export type GenerateResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Custo estimado em micro-dólares (1e-6 USD), pela tabela de preços. */
  costMicros: number;
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
