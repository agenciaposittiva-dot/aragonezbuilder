import { z } from "zod";

export const DEFAULT_ALLOWED_TYPES = [
  "image/",
  "video/",
  "audio/",
  "application/pdf",
  "application/zip",
  "application/postscript",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.ms-",
  "application/msword",
  "text/plain",
  "text/csv",
  "font/",
];

/** Configurações por organização, guardadas em `organizations.settings` (jsonb). */
export const orgSettingsSchema = z.object({
  uploads: z
    .object({
      maxBytes: z
        .number()
        .int()
        .positive()
        .default(100 * 1024 * 1024),
      allowedTypes: z.array(z.string()).min(1).default(DEFAULT_ALLOWED_TYPES),
    })
    .prefault({}),
  portal: z
    .object({
      showInvoices: z.boolean().default(false),
      showProjectProgress: z.boolean().default(true),
      allowRequestCreation: z.boolean().default(true),
      /** Logo da agência discreta no portal ("por Agência"); a marca do cliente continua em destaque. */
      showAgencyLogo: z.boolean().default(false),
    })
    .prefault({}),
  ai: z
    .object({
      enabled: z.boolean().default(true),
      provider: z.enum(["anthropic", "openai", "gemini", "demo"]).default("anthropic"),
      model: z.string().default(""),
      /** Autoriza o envio de dados de clientes (tom de voz, briefings...) ao provedor externo. */
      allowClientContext: z.boolean().default(false),
      monthlyTokenLimit: z.number().int().nonnegative().default(2_000_000),
      userDailyRequestLimit: z.number().int().nonnegative().default(100),
      /** Limite mensal de custo estimado (micro-dólares; 0 = sem limite). Só conta gerações com custo conhecido. */
      monthlyCostLimitMicros: z.number().int().nonnegative().default(0),
      /** Pede confirmação quando o custo estimado de uma geração passa deste valor (micro-dólares; 0 = nunca). */
      confirmAboveMicros: z.number().int().nonnegative().default(0),
      /** Chaves de API próprias da organização, sempre criptografadas (src/server/crypto.ts). */
      keys: z
        .object({ anthropic: z.string().optional(), openai: z.string().optional(), gemini: z.string().optional() })
        .default({}),
    })
    .prefault({}),
  time: z.object({ trackingEnabled: z.boolean().default(true) }).prefault({}),
  locale: z
    .object({
      currency: z.string().default("BRL"),
      timezone: z.string().default("America/Sao_Paulo"),
    })
    .prefault({}),
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export function parseOrgSettings(raw: unknown): OrgSettings {
  const parsed = orgSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : orgSettingsSchema.parse({});
}
