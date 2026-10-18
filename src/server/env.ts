import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: optional,
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET precisa ter 32+ caracteres"),
  ENCRYPTION_KEY: optional,
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
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
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  SMTP_FROM: z.string().default("Aragonez <nao-responda@localhost>"),
  ANTHROPIC_API_KEY: optional,
  OPENAI_API_KEY: optional,
  AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai", "demo"]).default("anthropic"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
