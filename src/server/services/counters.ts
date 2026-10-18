import { sql } from "drizzle-orm";
import { counters } from "@/server/db/schema";
import type { Scope } from "@/server/authz";

/**
 * Próximo número sequencial da organização para a chave (ex.: "request", "invoice").
 * Atômico: um único INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
 */
export async function nextCounter(s: Scope, key: string): Promise<number> {
  const [row] = await s.db
    .insert(counters)
    .values({ organizationId: s.actor.orgId, key, value: 1 })
    .onConflictDoUpdate({ target: [counters.organizationId, counters.key], set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row!.value;
}
