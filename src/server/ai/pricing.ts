/**
 * Preços de referência (USD por milhão de tokens) usados para estimar o custo
 * de cada chamada. Valores públicos de tabela; atualize quando o provedor mudar.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

/** Custo em micro-dólares: tokens × (US$ por 1M) = micro-dólares. */
export function estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return Math.round(inputTokens * p.input + outputTokens * p.output);
}

export function hasPrice(model: string) {
  return model in PRICES;
}
