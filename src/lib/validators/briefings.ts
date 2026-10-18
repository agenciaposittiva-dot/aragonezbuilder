import { z } from "zod";
import { optionalText, optionalUuid, requiredText } from "./common";

export const BRIEFING_CATEGORIES = [
  "design",
  "social_media",
  "video",
  "campaign",
  "presentation",
  "branding",
  "copy",
  "website",
  "other",
] as const;
export type BriefingCategory = (typeof BRIEFING_CATEGORIES)[number];

export const BRIEFING_CATEGORY_LABEL: Record<BriefingCategory, string> = {
  design: "Design",
  social_media: "Social media",
  video: "Vídeo",
  campaign: "Campanha",
  presentation: "Apresentação",
  branding: "Identidade visual",
  copy: "Redação",
  website: "Site",
  other: "Outro",
};

export const BRIEFING_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "url",
  "select",
  "multiselect",
  "checkbox",
] as const;

export const BRIEFING_FIELD_TYPE_LABEL: Record<(typeof BRIEFING_FIELD_TYPES)[number], string> = {
  text: "Texto curto",
  textarea: "Texto longo",
  number: "Número",
  date: "Data",
  url: "Link",
  select: "Escolha única",
  multiselect: "Múltipla escolha",
  checkbox: "Sim/não",
};

export const briefingFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,40}$/, "Use letras minúsculas, números e _"),
    label: z.string().trim().min(1, "Informe o rótulo").max(120),
    type: z.enum(BRIEFING_FIELD_TYPES),
    required: z.boolean().optional(),
    help: z.string().trim().max(300).optional(),
    placeholder: z.string().trim().max(120).optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  })
  .refine((f) => !["select", "multiselect"].includes(f.type) || (f.options?.length ?? 0) > 0, {
    message: "Informe ao menos uma opção",
    path: ["options"],
  });

export const briefingTemplateInput = z
  .object({
    id: optionalUuid,
    name: requiredText("o nome", 100),
    category: z.enum(BRIEFING_CATEGORIES),
    description: optionalText(500),
    isActive: z.boolean().default(true),
    fields: z.array(briefingFieldSchema).max(60),
  })
  .refine((t) => new Set(t.fields.map((f) => f.key)).size === t.fields.length, {
    message: "Há campos com a mesma chave",
    path: ["fields"],
  });
