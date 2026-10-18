import "server-only";

/**
 * Verificação leve (sem carregar src/server/env.ts, que falha sem as variáveis)
 * para levar ao diagnóstico /setup em vez de um erro genérico no primeiro deploy.
 */
export function essentialConfigPresent(): boolean {
  const e = process.env;
  return !!(e.DATABASE_URL || e.POSTGRES_URL) && (e.BETTER_AUTH_SECRET ?? "").length >= 32;
}
