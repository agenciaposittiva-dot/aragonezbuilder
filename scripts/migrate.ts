/**
 * Aplica as migrações versionadas (pasta drizzle/) com o papel dono das tabelas
 * e, em seguida:
 *  - reaplica o RLS em toda tabela com organization_id (cobre tabelas novas);
 *  - concede ao papel de execução (usuário de DATABASE_URL) acesso DML.
 *
 * Se a aplicação usa o mesmo usuário dono das tabelas (comum em bancos criados
 * pela integração da Vercel), cria o papel sem login e sem BYPASSRLS
 * "aragonez_rls", que a aplicação assume em cada transação (SET LOCAL ROLE).
 *
 * Uso: npm run db:migrate   (ou: tsx scripts/migrate.ts --env .env.test)
 *      --if-configured  não falha quando não há banco configurado (build da Vercel)
 *      SKIP_DB_MIGRATE=1 pula as migrações
 *
 * Com ARAGONEZ_ADMIN (e-mail) e ARAGONEZ_ADMIN_PASS definidos, cria a conta
 * administradora se ela ainda não existir (nunca altera a senha de uma conta
 * existente). Essa conta cria agências sem precisar da chave de acesso.
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env";
config({ path: envFile, quiet: true });

const e = process.env;
// Mesmos nomes alternativos aceitos por src/server/env.ts (integrações Neon/Supabase).
const appUrl = e.DATABASE_URL || e.POSTGRES_URL;
const ownerUrl = e.DATABASE_OWNER_URL || e.DATABASE_URL_UNPOOLED || e.POSTGRES_URL_NON_POOLING || appUrl;
const RLS_ROLE = "aragonez_rls";

if (e.SKIP_DB_MIGRATE === "1" || e.SKIP_DB_MIGRATE === "true") {
  console.log("SKIP_DB_MIGRATE definido: migrações ignoradas.");
  process.exit(0);
}
if (!ownerUrl || !appUrl) {
  if (process.argv.includes("--if-configured")) {
    console.log("Nenhum banco configurado (DATABASE_URL): migrações ignoradas neste build.");
    process.exit(0);
  }
  throw new Error("Defina DATABASE_URL (e, se usar um papel separado, DATABASE_OWNER_URL).");
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function grantDml(client: Client, role: string) {
  const r = quote(role);
  await client.query(`grant usage on schema public to ${r}`);
  await client.query(`grant select, insert, update, delete on all tables in schema public to ${r}`);
  await client.query(`grant usage, select on all sequences in schema public to ${r}`);
  await client.query(
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${r}`,
  );
  await client.query(`alter default privileges in schema public grant usage, select on sequences to ${r}`);
}

/** Cria a conta administradora inicial, se configurada e ainda inexistente. */
async function ensureAdmin(client: Client) {
  const email = e.ARAGONEZ_ADMIN?.trim().toLowerCase();
  const password = e.ARAGONEZ_ADMIN_PASS;
  if (!email || !password) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.warn("⚠️  ARAGONEZ_ADMIN precisa ser um e-mail; conta administradora não criada.");
    return;
  }
  if (password.length < 8) {
    console.warn("⚠️  ARAGONEZ_ADMIN_PASS precisa ter 8+ caracteres; conta administradora não criada.");
    return;
  }
  const { rows } = await client.query('select 1 from "user" where lower(email) = $1', [email]);
  if (rows.length) {
    console.log("✓ Conta administradora já existe (senha mantida)");
    return;
  }
  const id = randomUUID();
  const name = e.ARAGONEZ_ADMIN_NAME?.trim() || "Administrador";
  await client.query("begin");
  try {
    await client.query('insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)', [
      id,
      name,
      email,
    ]);
    await client.query(
      "insert into account (id, account_id, provider_id, user_id, password) values ($1, $2, 'credential', $2, $3)",
      [randomUUID(), id, await hashPassword(password)],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
  console.log("✓ Conta administradora criada (entre com ARAGONEZ_ADMIN e ARAGONEZ_ADMIN_PASS)");
}

async function main() {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const db = drizzle({ client, casing: "snake_case" });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await client.query("select app_apply_tenant_rls()");

    const appRole = decodeURIComponent(new URL(appUrl!).username);
    const ownerRole = decodeURIComponent(new URL(ownerUrl!).username);
    const sameUser = !appRole || appRole === ownerRole;

    if (!sameUser) {
      await grantDml(client, appRole);
      const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "select rolsuper, rolbypassrls from pg_roles where rolname = $1",
        [appRole],
      );
      if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
        console.warn(
          `⚠️  O papel "${appRole}" é superusuário ou tem BYPASSRLS: as políticas de isolamento não se aplicam a ele. Use um papel sem esses atributos em DATABASE_URL.`,
        );
      }
    } else if (e.DATABASE_RLS_ROLE !== "off") {
      // Um único usuário: a aplicação assume este papel em cada transação.
      const role = e.DATABASE_RLS_ROLE || RLS_ROLE;
      const { rows } = await client.query("select 1 from pg_roles where rolname = $1", [role]);
      try {
        if (!rows.length) await client.query(`create role ${quote(role)} nologin nobypassrls`);
        await grantDml(client, role);
        await client.query(`grant ${quote(role)} to current_user`);
      } catch (err) {
        throw new Error(
          `Não foi possível preparar o papel "${role}" (o usuário do banco precisa poder criar papéis). ` +
            `Crie-o manualmente (veja docs/DEPLOY.md) ou defina DATABASE_RLS_ROLE=off. Detalhe: ${(err as Error).message}`,
        );
      }
      const check = await client.query<{ ok: boolean }>("select pg_has_role(current_user, $1, 'SET') as ok", [role]);
      if (!check.rows[0]?.ok) throw new Error(`O usuário atual não consegue assumir o papel "${role}".`);
      console.log(`✓ Papel de isolamento "${role}" pronto (a aplicação o assume em cada transação)`);
    }
    await ensureAdmin(client);
    console.log("✓ Migrações aplicadas");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
