/*
 * Localiza a conexão do banco nas variáveis de ambiente (nomes padrão ou com o
 * prefixo de uma integração). Sem dependências: usado pela aplicação, pelo
 * diagnóstico /setup e pelos scripts.
 */
import { pickEnv } from "./env-names";

/**
 * Torna explícito o modo SSL que o driver já aplica. Integrações (Neon,
 * Supabase) entregam `sslmode=require`; o `pg` 8 trata `prefer`, `require` e
 * `verify-ca` como `verify-full` e avisa no log que isso muda no pg 9. Gravar
 * `verify-full` mantém o mesmo comportamento sem o aviso. Quem pedir a
 * compatibilidade libpq (`uselibpqcompat=true`) é respeitado; só o valor de
 * `sslmode` é trocado, o resto da URL fica como veio.
 */
export function normalizeSslMode(url: string | undefined): string | undefined {
  if (!url || /[?&]uselibpqcompat=/i.test(url)) return url;
  return url.replace(/([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|$)/i, "$1verify-full");
}

/** Conexão usada pela aplicação (pode passar por pooler). */
export function databaseUrl(): string | undefined {
  return normalizeSslMode(pickEnv("DATABASE_URL", "POSTGRES_URL"));
}

/** Conexão direta para migrações (sem pooler), quando existir. */
export function databaseOwnerUrl(): string | undefined {
  return normalizeSslMode(
    process.env.DATABASE_OWNER_URL || pickEnv("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"),
  );
}
