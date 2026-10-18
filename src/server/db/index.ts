import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __aragonezPool?: Pool };

export const pool =
  globalForDb.__aragonezPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });

if (env.NODE_ENV !== "production") globalForDb.__aragonezPool = pool;

export const db = drizzle({ client: pool, schema, casing: "snake_case" });

export type Database = typeof db;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Executa `fn` numa transação restrita a uma organização.
 * As políticas RLS do banco só retornam/aceitam linhas dessa organização,
 * mesmo que uma consulta esqueça o filtro por organization_id.
 */
export function withOrg<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
    return fn(tx);
  });
}

/**
 * Executa `fn` com o bypass de RLS ligado. Uso restrito a operações de sistema
 * que, por natureza, cruzam organizações: resolver a organização a partir do
 * slug no login, listar as organizações do usuário, criar organização, seed e
 * o despachante de eventos do worker. Nunca exponha a interface a este modo.
 */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.rls_bypass', 'on', true)`);
    return fn(tx);
  });
}

export { schema };
