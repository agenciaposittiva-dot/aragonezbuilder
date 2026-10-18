import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { rateLimit } from "@/server/db/schema";

/**
 * Limite simples por chave e janela fixa, na mesma tabela do limitador do
 * login (chaves com prefixo "app:"). Devolve false quando passou do limite.
 */
export async function consumeRateLimit(key: string, opts: { windowSec: number; max: number }): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - opts.windowSec * 1000;
  const k = `app:${key}`;
  const [row] = await withSystem((tx) =>
    tx
      .insert(rateLimit)
      .values({ id: randomUUID(), key: k, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`case when ${rateLimit.lastRequest} < ${windowStart} then 1 else ${rateLimit.count} + 1 end`,
          lastRequest: sql`case when ${rateLimit.lastRequest} < ${windowStart} then ${now} else ${rateLimit.lastRequest} end`,
        },
      })
      .returning({ count: rateLimit.count }),
  );
  return (row?.count ?? 1) <= opts.max;
}

/** IP de quem fez o pedido (atrás do proxy da hospedagem). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "desconhecido";
}
