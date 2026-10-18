/**
 * Aplica as migrações versionadas (pasta drizzle/) com o papel dono das tabelas
 * e, em seguida:
 *  - reaplica o RLS em toda tabela com organization_id (cobre tabelas novas);
 *  - concede ao papel de execução (usuário de DATABASE_URL) acesso DML.
 *
 * Uso: npm run db:migrate   (ou: tsx scripts/migrate.ts --env .env.test)
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env";
config({ path: envFile, quiet: true });

const ownerUrl = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error("Defina DATABASE_URL e DATABASE_OWNER_URL");

async function main() {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const db = drizzle({ client, casing: "snake_case" });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await client.query("select app_apply_tenant_rls()");

    const appRole = decodeURIComponent(new URL(appUrl!).username);
    const ownerRole = decodeURIComponent(new URL(ownerUrl!).username);
    if (appRole && appRole !== ownerRole) {
      const role = `"${appRole.replace(/"/g, '""')}"`;
      await client.query(`grant usage on schema public to ${role}`);
      await client.query(`grant select, insert, update, delete on all tables in schema public to ${role}`);
      await client.query(`grant usage, select on all sequences in schema public to ${role}`);
      await client.query(
        `alter default privileges in schema public grant select, insert, update, delete on tables to ${role}`,
      );
      await client.query(`alter default privileges in schema public grant usage, select on sequences to ${role}`);
    }

    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "select rolsuper, rolbypassrls from pg_roles where rolname = $1",
      [appRole],
    );
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      console.warn(
        `⚠️  O papel "${appRole}" é superusuário ou tem BYPASSRLS: as políticas de isolamento não se aplicam a ele. Use um papel sem esses atributos em DATABASE_URL.`,
      );
    }
    console.log("✓ Migrações aplicadas");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
