import "server-only";
import { databaseUrl } from "./db-url";

/**
 * Verificação leve (sem carregar src/server/env.ts, que falha sem as variáveis)
 * para levar ao diagnóstico /setup em vez de um erro genérico no primeiro deploy.
 */
export function essentialConfigPresent(): boolean {
  const e = process.env;
  return !!databaseUrl() && (e.BETTER_AUTH_SECRET ?? "").length >= 32;
}
