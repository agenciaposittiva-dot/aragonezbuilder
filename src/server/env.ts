import "server-only";
import { z } from "zod";
import { databaseOwnerUrl, databaseUrl } from "./db-url";
import { pickEnv } from "./env-names";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

/** Variável vazia ("") conta como não definida (comum em painéis de hospedagem). */
const blankAsUndefined = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: optional,
  /**
   * Papel sem BYPASSRLS assumido em cada transação (SET LOCAL ROLE) quando a
   * aplicação conecta com o mesmo usuário dono das tabelas. "off" desliga.
   */
  DATABASE_RLS_ROLE: optional,
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET precisa ter 32+ caracteres"),
  ENCRYPTION_KEY: optional,
  /** Chave exigida para criar novas agências (aceita também o nome ACESS_KEY). */
  ACCESS_KEY: optional,
  /** E-mail da conta administradora criada no deploy (com ARAGONEZ_ADMIN_PASS). */
  ARAGONEZ_ADMIN: optional,
  /** Origens extras aceitas no login (separadas por vírgula), ex.: domínio próprio. */
  TRUSTED_ORIGINS: optional,
  /**
   * local = disco · s3 = bucket compatível com S3 · blob = Vercel Blob (privado)
   * · database = no próprio Postgres. Padrão: s3 se houver bucket, blob se houver
   * Vercel Blob, database na Vercel e local nos demais casos.
   */
  STORAGE_DRIVER: blankAsUndefined(z.enum(["local", "s3", "blob", "database"]).optional()),
  BLOB_READ_WRITE_TOKEN: optional,
  BLOB_STORE_ID: optional,
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  S3_BUCKET: optional,
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  UPLOAD_MAX_BYTES: blankAsUndefined(z.coerce.number().int().positive().optional()),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  SMTP_FROM: z.string().default("Aragonez <nao-responda@localhost>"),
  ANTHROPIC_API_KEY: optional,
  OPENAI_API_KEY: optional,
  /** Protege /api/cron/tick (processamento em lotes sem worker contínuo). */
  CRON_SECRET: optional,
  /**
   * Processa eventos e e-mails logo após cada operação (via after()), sem worker.
   * Padrão: ligado na Vercel (onde não há processo contínuo), desligado nos demais.
   */
  EVENTS_INLINE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? !!process.env.VERCEL : v === "true")),
  /** Provedor inicial das novas organizações (padrão: o primeiro com chave configurada). */
  AI_DEFAULT_PROVIDER: blankAsUndefined(z.enum(["anthropic", "openai", "gemini", "demo"]).optional()),
  GEMINI_API_KEY: optional,
  /** Redis (Upstash) para o limite de tentativas do login. */
  UPSTASH_REDIS_REST_URL: optional,
  UPSTASH_REDIS_REST_TOKEN: optional,
});

type Parsed = z.infer<typeof schema>;

export type Env = Omit<Parsed, "STORAGE_DRIVER" | "UPLOAD_MAX_BYTES" | "DATABASE_RLS_ROLE" | "AI_DEFAULT_PROVIDER"> & {
  AI_DEFAULT_PROVIDER: "anthropic" | "openai" | "gemini" | "demo";
  STORAGE_DRIVER: "local" | "s3" | "blob" | "database";
  UPLOAD_MAX_BYTES: number;
  /** Papel assumido nas transações, ou null quando a conexão já é um papel sem BYPASSRLS. */
  DATABASE_RLS_ROLE: string | null;
  /** Origens aceitas pelo login: APP_URL, endereços da Vercel e TRUSTED_ORIGINS. */
  trustedOrigins: string[];
};

/** Papel criado por scripts/migrate.ts para instalações com um único usuário de banco. */
export const DEFAULT_RLS_ROLE = "aragonez_rls";

/** Corpo máximo de requisição das funções da Vercel (4,5 MB) menos a folga do multipart. */
const VERCEL_UPLOAD_LIMIT = 4 * 1024 * 1024;

const isVercel = !!process.env.VERCEL;

/**
 * Normaliza nomes alternativos usados por integrações (Neon e Supabase na
 * Vercel criam POSTGRES_URL / DATABASE_URL_UNPOOLED etc.) e deriva o endereço
 * público do deploy quando APP_URL não foi definido.
 */
function source(): NodeJS.ProcessEnv {
  const e = process.env;
  const vercelHost =
    e.VERCEL_ENV === "production" && e.VERCEL_PROJECT_PRODUCTION_URL
      ? e.VERCEL_PROJECT_PRODUCTION_URL
      : (e.VERCEL_BRANCH_URL ?? e.VERCEL_URL);
  return {
    ...e,
    DATABASE_URL: databaseUrl(),
    ACCESS_KEY: e.ACCESS_KEY || e.ACESS_KEY,
    UPSTASH_REDIS_REST_URL: pickEnv("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"),
    UPSTASH_REDIS_REST_TOKEN: pickEnv("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"),
    BLOB_READ_WRITE_TOKEN: pickEnv("BLOB_READ_WRITE_TOKEN"),
    BLOB_STORE_ID: pickEnv("BLOB_STORE_ID"),
    GEMINI_API_KEY: pickEnv("GEMINI_API_KEY"),
    DATABASE_OWNER_URL: databaseOwnerUrl(),
    APP_URL: e.APP_URL || (vercelHost ? `https://${vercelHost}` : undefined),
  };
}

function userOf(url: string | undefined) {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).username) || null;
  } catch {
    return null;
  }
}

function finish(p: Parsed): Env {
  const e = process.env;
  const origins = new Set<string>([new URL(p.APP_URL).origin]);
  for (const host of [e.VERCEL_URL, e.VERCEL_BRANCH_URL, e.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) origins.add(`https://${host}`);
  }
  for (const o of (p.TRUSTED_ORIGINS ?? "").split(",")) {
    try {
      if (o.trim()) origins.add(new URL(o.trim()).origin);
    } catch {
      /* origem inválida é ignorada */
    }
  }
  const sameUser = !p.DATABASE_OWNER_URL || userOf(p.DATABASE_OWNER_URL) === userOf(p.DATABASE_URL);
  const rlsRole = p.DATABASE_RLS_ROLE === "off" ? null : (p.DATABASE_RLS_ROLE ?? (sameUser ? DEFAULT_RLS_ROLE : null));
  return {
    ...p,
    STORAGE_DRIVER:
      p.STORAGE_DRIVER ??
      (p.S3_BUCKET
        ? "s3"
        : p.BLOB_READ_WRITE_TOKEN || (isVercel && p.BLOB_STORE_ID)
          ? "blob"
          : isVercel
            ? "database"
            : "local"),
    UPLOAD_MAX_BYTES: p.UPLOAD_MAX_BYTES ?? (isVercel ? VERCEL_UPLOAD_LIMIT : 100 * 1024 * 1024),
    DATABASE_RLS_ROLE: rlsRole,
    AI_DEFAULT_PROVIDER:
      p.AI_DEFAULT_PROVIDER ??
      (p.ANTHROPIC_API_KEY ? "anthropic" : p.GEMINI_API_KEY ? "gemini" : p.OPENAI_API_KEY ? "openai" : "anthropic"),
    trustedOrigins: [...origins],
  };
}

/**
 * Durante o `next build` nenhuma conexão é aberta, então as variáveis
 * obrigatórias podem não existir no ambiente de build (ex.: Vercel sem
 * variáveis de build). Nesse caso usamos valores provisórios; em execução a
 * validação é obrigatória e falha com uma mensagem clara.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const BUILD_PLACEHOLDERS = {
  DATABASE_URL: "postgres://build:build@127.0.0.1:5432/build",
  BETTER_AUTH_SECRET: "build-placeholder-secret-not-used-at-runtime",
};

function load(): Env {
  const input = source();
  const parsed = schema.safeParse(input);
  if (parsed.success) return finish(parsed.data);
  if (isBuildPhase) {
    return finish(
      schema.parse({
        ...input,
        DATABASE_URL: input.DATABASE_URL || BUILD_PLACEHOLDERS.DATABASE_URL,
        BETTER_AUTH_SECRET:
          input.BETTER_AUTH_SECRET && input.BETTER_AUTH_SECRET.length >= 32
            ? input.BETTER_AUTH_SECRET
            : BUILD_PLACEHOLDERS.BETTER_AUTH_SECRET,
      }),
    );
  }
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(
    `Variáveis de ambiente inválidas:\n${issues}\nConfigure-as no servidor (veja docs/DEPLOY.md). Diagnóstico: /setup`,
  );
}

export const env = load();
