/*
 * Localiza a conexão do banco nas variáveis de ambiente. Além dos nomes padrão,
 * aceita os criados por integrações com prefixo (ex.: a Vercel cria
 * "meuprojeto_DATABASE_URL" quando um prefixo é escolhido ao conectar o Neon).
 * Nomes exatos sempre têm prioridade. Sem dependências: usado pela aplicação,
 * pelo diagnóstico /setup e pelos scripts.
 */

function pick(names: string[]): string | undefined {
  const e = process.env;
  for (const n of names) if (e[n]) return e[n];
  const keys = Object.keys(e).sort();
  for (const n of names) {
    const key = keys.find((k) => k.endsWith(`_${n}`) && e[k]);
    if (key) return e[key];
  }
  return undefined;
}

/** Conexão usada pela aplicação (pode passar por pooler). */
export function databaseUrl(): string | undefined {
  return pick(["DATABASE_URL", "POSTGRES_URL"]);
}

/** Conexão direta para migrações (sem pooler), quando existir. */
export function databaseOwnerUrl(): string | undefined {
  return process.env.DATABASE_OWNER_URL || pick(["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"]);
}
