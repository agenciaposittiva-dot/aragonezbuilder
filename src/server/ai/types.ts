import type { ModelCaps } from "@/lib/ai-tasks";

export type AiProviderId = "anthropic" | "openai" | "gemini" | "magnific" | "demo";

/** Opções de conexão por credencial (BYOK): endereço base alternativo, só em provedores compatíveis. */
export type ProviderOpts = { baseUrl?: string | null };

/** De quem é a credencial em uso: pessoal, da organização, do servidor, ou nenhuma (ex.: demonstração). */
export type KeySource = "user" | "org" | "env" | "none";

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
  /** Quantidade de imagens (só enviado quando informado; padrão da API: 1). */
  n?: number;
  /** Nível de qualidade no vocabulário do provedor (ex.: OpenAI: auto, low, medium, high); só enviado quando informado. */
  quality?: string;
  /** Proporção no vocabulário do provedor (ex.: Magnific: square_1_1), quando a API recebe proporção em vez de tamanho. */
  aspectRatio?: string;
  /** Resolução no vocabulário do provedor (ex.: Magnific: 1k, 2k, 4k). */
  resolution?: string;
  /** Instruções negativas (só para APIs que têm o parâmetro). */
  negativePrompt?: string;
  /** Imagens de referência (só para modelos que aceitam): estrutura/composição e/ou estilo. */
  references?: { structure?: Buffer; structureStrength?: number; style?: Buffer; adherence?: number };
  /** Endereço base alternativo da credencial (BYOK), quando o provedor aceita. */
  baseUrl?: string | null;
  signal?: AbortSignal;
};

/** Ampliação (upscale) de uma imagem existente por um modelo que amplia. */
export type ImageUpscaleRequest = {
  model: string;
  /** Imagem original (PNG, JPEG ou WebP). */
  image: Buffer;
  mimeType: string;
  /** Fator de ampliação (2, 4, 8 ou 16). */
  scale: number;
  /** Descrição opcional (modelos criativos). */
  prompt?: string;
  /** Opções no vocabulário do provedor; só enviadas quando informadas. */
  optimizedFor?: string;
  creativity?: number;
  hdr?: number;
  resemblance?: number;
  fractality?: number;
  engine?: string;
  flavor?: string;
  sharpen?: number;
  smartGrain?: number;
  ultraDetail?: number;
  baseUrl?: string | null;
  signal?: AbortSignal;
};

/** Edição de uma imagem existente: a original vai junto como referência. */
export type ImageEditRequest = {
  model: string;
  prompt: string;
  /** Imagem original (PNG, JPEG ou WebP). */
  image: Buffer;
  mimeType: string;
  /** Ex.: "1024x1024" ou "auto". */
  size: string;
  baseUrl?: string | null;
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
