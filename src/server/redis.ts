import "server-only";
import { env } from "@/server/env";

/** Prefixo das chaves: o mesmo Redis pode ser compartilhado com outros projetos. */
const PREFIX = "aragonez:";

export const redisConfigured = () => !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

/** Executa um comando na API REST do Upstash (sem dependências extras). */
async function command<T>(args: (string | number)[]): Promise<T> {
  const res = await fetch(env.UPSTASH_REDIS_REST_URL!, {
    method: "POST",
    headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(args.map(String)),
    signal: AbortSignal.timeout(3000),
  });
  const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `Upstash respondeu ${res.status}`);
  return data.result as T;
}

// Janela fixa atômica: incrementa e define a expiração na primeira requisição da janela.
const CONSUME = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('TTL', KEYS[1])}`;

/**
 * Limite de tentativas do login (Better Auth) no Redis: rápido e sem gravar no
 * banco a cada requisição. Se o Redis estiver indisponível, a requisição segue
 * (o erro vai para o log) para não derrubar o acesso de todos.
 */
export function redisRateLimitStorage() {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      try {
        const [count, ttl] = await command<[number, number]>(["EVAL", CONSUME, 1, `${PREFIX}rl:${key}`, rule.window]);
        return count <= rule.max
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
      } catch (err) {
        console.error("[rate-limit] Redis indisponível; requisição liberada", err);
        return { allowed: true, retryAfter: null };
      }
    },
  };
}
