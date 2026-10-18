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
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)${roleClause()}`);
    return fn(tx);
  });
}

/**
 * Quando a aplicação conecta com o usuário dono das tabelas (ex.: banco criado
 * pela integração da Vercel, com um único usuário), cada transação assume um
 * papel sem BYPASSRLS para que as políticas de isolamento continuem valendo.
 * O papel é criado por scripts/migrate.ts. SET LOCAL vale só para a transação,
 * o que é seguro com poolers em modo transação (PgBouncer).
 */
function roleClause() {
  return env.DATABASE_RLS_ROLE ? sql`, set_config('role', ${env.DATABASE_RLS_ROLE}, true)` : sql``;
}

/**
 * Executa `fn` com o bypass de RLS ligado. Uso restrito a operações de sistema
 * que, por natureza, cruzam organizações: resolver a organização a partir do
 * slug no login, listar as organizações do usuário, criar organização, seed e
 * o despachante de eventos do worker. Nunca exponha a interface a este modo.
 */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.rls_bypass', 'on', true)${roleClause()}`);
    return fn(tx);
  });
}

export { schema };
