import { z } from "zod";

/* Peças de conteúdo e campanhas (compartilhado entre servidor e interface). */

export const CONTENT_FORMATS = {
  feed: { label: "Feed (1080 × 1350)", width: 1080, height: 1350 },
  stories: { label: "Stories / Reels (1080 × 1920)", width: 1080, height: 1920 },
  carousel: { label: "Carrossel (1080 × 1350 por página)", width: 1080, height: 1350 },
  reels: { label: "Reels (roteiro)", width: 1080, height: 1920 },
  other: { label: "Outro", width: 1080, height: 1080 },
} as const;
export type ContentFormat = keyof typeof CONTENT_FORMATS;
export const CONTENT_FORMAT_KEYS = Object.keys(CONTENT_FORMATS) as [ContentFormat, ...ContentFormat[]];

export const CONTENT_STATUS = {
  idea: "Ideia",
  draft: "Rascunho",
  production: "Em produção",
  review: "Em revisão",
  approved: "Aprovado",
  scheduled: "Agendado",
  published: "Publicado",
} as const;
export type ContentStatus = keyof typeof CONTENT_STATUS;
export const CONTENT_STATUS_KEYS = Object.keys(CONTENT_STATUS) as [ContentStatus, ...ContentStatus[]];

export const CONTENT_STATUS_COLOR: Record<ContentStatus, string> = {
  idea: "zinc",
  draft: "slate",
  production: "blue",
  review: "amber",
  approved: "green",
  scheduled: "violet",
  published: "teal",
};

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const isoDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const slideInput = z.object({
  title: z.string().trim().max(200).default(""),
  text: z.string().trim().max(1200).default(""),
});

/** Textos de uma peça (os mesmos campos que a IA prepara e a equipe revisa). */
export const contentTextInput = z.object({
  title: z.string().trim().min(1, "Informe o título").max(200),
  concept: text(4000),
  strategy: text(4000),
  copy: text(4000),
  caption: text(4000),
  cta: text(300),
  script: text(8000),
  visualDirection: text(4000),
  imagePrompt: text(4000),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  slides: z.array(slideInput).max(10).default([]),
});

export const contentItemInput = contentTextInput.extend({
  clientId: z.uuid(),
  campaignId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  format: z.enum(CONTENT_FORMAT_KEYS).default("feed"),
  status: z.enum(CONTENT_STATUS_KEYS).default("draft"),
  plannedDate: isoDate,
});

export const contentUpdateInput = contentTextInput.partial().extend({
  id: z.uuid(),
  campaignId: z.uuid().nullable().optional(),
  format: z.enum(CONTENT_FORMAT_KEYS).optional(),
  status: z.enum(CONTENT_STATUS_KEYS).optional(),
  // Ausente = não altera (o .optional() externo preserva o undefined).
  plannedDate: isoDate.optional(),
});

export const campaignInput = z.object({
  clientId: z.uuid(),
  name: z.string().trim().min(2, "Informe o nome da campanha").max(160),
  objective: text(2000),
  startsOn: isoDate,
  endsOn: isoDate,
});

export const contentListParams = z.object({
  clientId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
  status: z.enum(CONTENT_STATUS_KEYS).optional(),
  format: z.enum(CONTENT_FORMAT_KEYS).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  q: z.string().trim().max(120).optional(),
});
