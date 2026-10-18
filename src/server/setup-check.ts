import "server-only";
import { Client } from "pg";
import journal from "../../drizzle/meta/_journal.json";
import { databaseUrl } from "./db-url";

/*
 * Diagnóstico da instalação para a página /setup. Não importa src/server/env.ts
 * diretamente (ele falha quando faltam variáveis): lê process.env e tenta
 * carregar a configuração de forma isolada. Nunca devolve valores de segredos.
 */

export type CheckStatus = "ok" | "warn" | "error";
export type Check = { label: string; status: CheckStatus; detail: string };

const e = process.env;

function dbUrl() {
  return databaseUrl() ?? "";
}

function describeDbError(err: unknown): string {
  const code = (err as { code?: string }).code ?? "";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code))
    return "O endereço do banco não foi encontrado (confira DATABASE_URL).";
  if (["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(code))
    return "O banco não aceitou a conexão (endereço, porta ou firewall).";
  if (code === "28P01" || code === "28000") return "Usuário ou senha do banco inválidos.";
  if (code === "3D000") return "O banco informado em DATABASE_URL não existe.";
  if (/ssl/i.test(String((err as Error).message)))
    return "Falha de SSL ao conectar (tente acrescentar ?sslmode=require).";
  if (/timeout/i.test(String((err as Error).message))) return "Tempo esgotado ao conectar no banco.";
  return "Não foi possível conectar ao banco.";
}

async function checkDatabase(): Promise<Check[]> {
  const url = dbUrl();
  if (!url) return [];
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 6000 });
  try {
    await client.connect();
    const { rows } = await client.query<{
      migrated: boolean;
      tracked: boolean;
      rls_role: boolean;
      bypass: boolean;
    }>(
      `select to_regclass('public.organizations') is not null as migrated,
              exists (
                select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'drizzle' and c.relname = '__drizzle_migrations'
                  and has_schema_privilege(n.oid, 'USAGE') and has_table_privilege(c.oid, 'SELECT')
              ) as tracked,
              exists (select 1 from pg_roles where rolname = 'aragonez_rls') as rls_role,
              (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as bypass`,
    );
    const r = rows[0]!;
    // As migrações aplicadas são registradas com a data da migração (a mesma do journal).
    // `null` = este usuário do banco não pode ler o registro de migrações (ex.: usuário só da aplicação).
    let applied: number | null = null;
    if (r.tracked) {
      try {
        const last = await client.query<{ last: string | null }>(
          "select max(created_at)::text as last from drizzle.__drizzle_migrations",
        );
        const lastWhen = Number(last.rows[0]?.last ?? 0);
        applied = journal.entries.filter((m) => m.when <= lastWhen).length;
      } catch {
        applied = null;
      }
    }
    const total = journal.entries.length;
    const out: Check[] = [{ label: "Conexão com o banco", status: "ok", detail: "Conectado." }];
    out.push(
      r.migrated && applied === null
        ? {
            label: "Tabelas",
            status: "ok",
            detail: "Tabelas criadas (a lista de migrações não é visível para este usuário do banco).",
          }
        : r.migrated && applied !== null && applied >= total
          ? { label: "Tabelas", status: "ok", detail: `Migrações aplicadas (${applied} de ${total}).` }
          : r.migrated
            ? {
                label: "Tabelas",
                status: "error",
                detail: `Faltam ${total - (applied ?? 0)} de ${total} migrações. Faça um novo deploy (o build aplica as migrações) ou rode npm run db:migrate.`,
              }
            : {
                label: "Tabelas",
                status: "error",
                detail:
                  "As tabelas ainda não existem. Faça um novo deploy (o build aplica as migrações) ou rode npm run db:migrate.",
              },
    );
    if (r.migrated && r.bypass && !r.rls_role && e.DATABASE_RLS_ROLE !== "off") {
      out.push({
        label: "Isolamento entre agências (RLS)",
        status: "warn",
        detail: "O usuário do banco ignora RLS e o papel aragonez_rls não existe. Rode as migrações novamente.",
      });
    }
    return out;
  } catch (err) {
    return [{ label: "Conexão com o banco", status: "error", detail: describeDbError(err) }];
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runSetupChecks(): Promise<{ checks: Check[]; ready: boolean }> {
  const checks: Check[] = [];
  const secret = e.BETTER_AUTH_SECRET ?? "";

  checks.push(
    dbUrl()
      ? { label: "DATABASE_URL", status: "ok", detail: "Definida." }
      : {
          label: "DATABASE_URL",
          status: "error",
          detail: "Falta o banco. Na Vercel: Storage → Create Database → Neon, conectado a este projeto.",
        },
  );
  checks.push(
    secret.length >= 32
      ? { label: "BETTER_AUTH_SECRET", status: "ok", detail: "Definida." }
      : {
          label: "BETTER_AUTH_SECRET",
          status: "error",
          detail: secret
            ? "Precisa ter pelo menos 32 caracteres."
            : "Falta o segredo dos logins (texto aleatório de 32+ caracteres).",
        },
  );
  checks.push(...(await checkDatabase()));

  let config: typeof import("@/server/env").env | null = null;
  try {
    config = (await import("@/server/env")).env;
  } catch {
    config = null;
  }

  if (config) {
    const storage = {
      s3: "Bucket S3",
      blob: "Vercel Blob (privado)",
      database: "No próprio banco (até 4 MB por arquivo)",
      local: "Disco local",
    }[config.STORAGE_DRIVER];
    checks.push({
      label: "Armazenamento de arquivos",
      status: config.STORAGE_DRIVER === "local" && e.VERCEL ? "warn" : "ok",
      detail:
        config.STORAGE_DRIVER === "local" && e.VERCEL
          ? "Disco local não é persistente na Vercel. Remova STORAGE_DRIVER=local."
          : storage,
    });
    const ai = [
      config.ANTHROPIC_API_KEY ? "Claude (Anthropic)" : null,
      config.GEMINI_API_KEY ? "Gemini" : null,
      config.OPENAI_API_KEY ? "OpenAI" : null,
    ].filter(Boolean);
    checks.push({
      label: "Inteligência artificial",
      status: ai.length ? "ok" : "warn",
      detail: ai.length
        ? `Chaves no servidor: ${ai.join(", ")}.`
        : "Sem chave no servidor: o assistente funciona em modo demonstração (ou com a chave salva por cada agência).",
    });
    checks.push({
      label: "E-mails",
      status: config.SMTP_HOST ? "ok" : "warn",
      detail: config.SMTP_HOST
        ? "SMTP configurado."
        : "Sem SMTP: convites e recuperação de senha não são enviados por e-mail.",
    });
    checks.push({
      label: "Instagram (Radar de Marca)",
      status: config.META_APP_ID && config.META_APP_SECRET ? "ok" : "warn",
      detail:
        config.META_APP_ID && config.META_APP_SECRET
          ? "App da Meta configurado: a conexão oficial com o Instagram está disponível."
          : "Sem META_APP_ID/META_APP_SECRET: o Radar de Marca funciona só com a entrada manual.",
    });
    checks.push({
      label: "Rotinas agendadas",
      status: config.CRON_SECRET ? "ok" : "warn",
      detail: config.CRON_SECRET ? "CRON_SECRET definido." : "Defina CRON_SECRET para proteger /api/cron/tick.",
    });
  }

  if (e.VERCEL && e.VERCEL_ENV && e.VERCEL_ENV !== "production") {
    checks.push({
      label: "Ambiente da Vercel",
      status: "warn",
      detail: `Este é um deploy de ${e.VERCEL_ENV === "preview" ? "Preview" : e.VERCEL_ENV}: ele só enxerga variáveis marcadas para esse ambiente.`,
    });
  }

  // Versão no ar (a Vercel informa o commit publicado): ajuda a confirmar um deploy.
  if (e.VERCEL_GIT_COMMIT_SHA) {
    checks.push({
      label: "Versão publicada",
      status: "ok",
      detail: [e.VERCEL_GIT_COMMIT_SHA.slice(0, 7), e.VERCEL_GIT_COMMIT_REF].filter(Boolean).join(" · "),
    });
  }

  return { checks, ready: !checks.some((c) => c.status === "error") };
}
