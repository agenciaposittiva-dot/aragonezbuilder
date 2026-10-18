/*
 * Localiza a conexão do banco nas variáveis de ambiente (nomes padrão ou com o
 * prefixo de uma integração). Sem dependências: usado pela aplicação, pelo
 * diagnóstico /setup e pelos scripts.
 */
import { pickEnv } from "./env-names";

/** Conexão usada pela aplicação (pode passar por pooler). */
export function databaseUrl(): string | undefined {
  return pickEnv("DATABASE_URL", "POSTGRES_URL");
}

/** Conexão direta para migrações (sem pooler), quando existir. */
export function databaseOwnerUrl(): string | undefined {
  return process.env.DATABASE_OWNER_URL || pickEnv("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING");
}
