/**
 * Teste de restauração do backup: prova que o backup volta inteiro.
 *
 *  1. Abre uma transação REPEATABLE READ no banco de origem e exporta o snapshot;
 *  2. pg_dump (formato custom) exatamente desse snapshot, ignorando o RLS;
 *  3. recria um banco de rascunho (nome terminado em _restore_check) e restaura o dump nele;
 *  4. compara a contagem de linhas de TODAS as tabelas (origem no mesmo snapshot × restaurado);
 *  5. confere os arquivos: cada versão registrada no banco restaurado precisa existir no
 *     armazenamento e uma amostra é baixada e comparada (tamanho e SHA-256).
 *
 * Uso: tsx --tsconfig tsconfig.node.json scripts/backup-check.ts --env .env [opções]
 *      --out <arquivo.dump>   onde guardar o dump (padrão: pasta temporária, apagada no fim)
 *      --target-db <nome>     banco de rascunho (padrão: <banco>_restore_check)
 *      --target-server <url>  servidor onde criar o rascunho (padrão: o mesmo da origem)
 *      --sample <n>           versões de arquivo baixadas e comparadas byte a byte (padrão 20)
 *      --keep                 mantém o banco de rascunho para inspeção
 *
 * Requer pg_dump/pg_restore da mesma versão maior do servidor e um usuário dono
 * das tabelas com permissão CREATEDB (DATABASE_OWNER_URL). Sai com código 1 se
 * qualquer conferência falhar. Nunca escreve no banco de origem.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";
import { databaseOwnerUrl, databaseUrl } from "../src/server/db-url";

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
config({ path: arg("--env") ?? ".env", quiet: true });

const sourceUrl = databaseOwnerUrl() || databaseUrl() || "";
if (!sourceUrl) throw new Error("Defina DATABASE_OWNER_URL (ou DATABASE_URL).");
const source = new URL(sourceUrl);
const sourceDb = decodeURIComponent(source.pathname.slice(1));
const targetDb = arg("--target-db") ?? `${sourceDb}_restore_check`;
if (targetDb === sourceDb || !targetDb.endsWith("_restore_check")) {
  throw new Error(`Banco de rascunho inválido: "${targetDb}". Use um nome terminado em _restore_check.`);
}
// Servidor do rascunho: o mesmo da origem ou outro (ex.: Postgres descartável da rotina periódica).
const targetServer = arg("--target-server") ?? sourceUrl;
const withDb = (name: string) =>
  Object.assign(new URL(targetServer), { pathname: `/${encodeURIComponent(name)}` }).href;
const targetUrl = withDb(targetDb);
const sample = Number(arg("--sample") ?? 20);
const keep = process.argv.includes("--keep");
const BYPASS = "-c app.rls_bypass=on";
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

const failures: string[] = [];
const log = (msg: string) => console.log(msg);

function run(cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, { env: { ...process.env, PGOPTIONS: BYPASS }, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} falhou (${res.status}):\n${res.stderr || res.stdout}`);
  return res.stderr;
}

async function tableCounts(client: Client) {
  const { rows } = await client.query<{ s: string; t: string }>(
    `select table_schema as s, table_name as t from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema in ('public', 'drizzle') order by 1, 2`,
  );
  const counts = new Map<string, number>();
  for (const { s, t } of rows) {
    const r = await client.query<{ n: string }>(`select count(*)::text as n from ${quote(s)}.${quote(t)}`);
    counts.set(`${s}.${t}`, Number(r.rows[0]!.n));
  }
  return counts;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "aragonez-backup-"));
  const dumpFile = arg("--out") ?? join(workDir, `${sourceDb}.dump`);
  const started = Date.now();

  // 1–2. Snapshot exportado: o dump e as contagens de origem enxergam exatamente os mesmos dados.
  const src = new Client({ connectionString: sourceUrl, options: BYPASS });
  await src.connect();
  await src.query("begin isolation level repeatable read read only");
  const snap = (await src.query<{ id: string }>("select pg_export_snapshot() as id")).rows[0]!.id;
  log(`Origem: ${sourceDb} (snapshot ${snap})`);
  run("pg_dump", [
    "--format=custom",
    "--enable-row-security",
    "--no-owner",
    "--no-acl",
    `--snapshot=${snap}`,
    `--file=${dumpFile}`,
    sourceUrl,
  ]);
  const before = await tableCounts(src);
  await src.query("commit");
  await src.end();
  log(`Dump: ${dumpFile} (${(statSync(dumpFile).size / 1024).toFixed(0)} KB, ${before.size} tabelas)`);

  // 3. Banco de rascunho limpo + restauração.
  const admin = new Client({ connectionString: withDb("postgres") });
  await admin.connect();
  await admin.query(`drop database if exists ${quote(targetDb)} with (force)`);
  await admin.query(`create database ${quote(targetDb)}`);
  const warnings = run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", `--dbname=${targetUrl}`, dumpFile]);
  if (warnings.trim()) log(`Avisos do pg_restore:\n${warnings.trim()}`);
  log(`Restaurado em: ${targetDb}`);

  // 4. Contagens tabela a tabela.
  const dst = new Client({ connectionString: targetUrl, options: BYPASS });
  await dst.connect();
  const after = await tableCounts(dst);
  let rows = 0;
  for (const [table, n] of before) {
    rows += n;
    const m = after.get(table);
    if (m !== n) failures.push(`${table}: origem ${n}, restaurado ${m ?? "ausente"}`);
  }
  for (const table of after.keys()) if (!before.has(table)) failures.push(`${table}: só existe no restaurado`);
  log(`Linhas conferidas: ${rows} em ${before.size} tabelas`);

  // 5. Arquivos: existência de todas as versões e amostra byte a byte.
  const { env } = await import("../src/server/env");
  const versions = (
    await dst.query<{ key: string; size: string; sha: string | null }>(
      `select storage_key as key, size_bytes::text as size, checksum_sha256 as sha from file_versions order by random()`,
    )
  ).rows;
  let read: (key: string) => Promise<Buffer | null>;
  if (env.STORAGE_DRIVER === "database") {
    // Os bytes estão no próprio banco: lê do restaurado (é o que o backup precisa provar).
    read = async (key) =>
      (await dst.query<{ data: Buffer }>("select data from storage_objects where key = $1", [key])).rows[0]?.data ??
      null;
  } else {
    // Local/S3/Blob ficam fora do dump: confere que o armazenamento ainda tem cada objeto citado.
    const { getStorage } = await import("../src/server/storage");
    const storage = getStorage();
    read = async (key) => ((await storage.exists(key)) ? storage.get(key) : null);
  }
  let checked = 0;
  for (const [i, v] of versions.entries()) {
    const body = await read(v.key).catch(() => null);
    if (!body) {
      failures.push(`arquivo ausente: ${v.key}`);
      continue;
    }
    if (i < sample) {
      checked++;
      if (body.length !== Number(v.size)) failures.push(`${v.key}: ${body.length} bytes, esperado ${v.size}`);
      const sha = createHash("sha256").update(body).digest("hex");
      if (v.sha && v.sha !== sha) failures.push(`${v.key}: SHA-256 diferente`);
    }
  }
  log(`Arquivos (${env.STORAGE_DRIVER}): ${versions.length} versões encontradas, ${checked} comparadas byte a byte`);
  await dst.end();

  if (!keep) await admin.query(`drop database if exists ${quote(targetDb)} with (force)`);
  await admin.end();
  if (!arg("--out")) rmSync(workDir, { recursive: true, force: true });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failures.length) {
    console.error(`\nFALHOU (${failures.length}) em ${secs}s:\n- ${failures.slice(0, 50).join("\n- ")}`);
    process.exit(1);
  }
  log(`\nOK: backup restaurado e conferido em ${secs}s.${keep ? ` Banco mantido: ${targetDb}` : ""}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
