import { z } from "zod";
import { isoDate, moneyCents, optionalText, optionalUuid, requiredText, uuid } from "./common";
import { LABEL_COLORS } from "./tasks";

export const CLIENT_STATUS = ["lead", "active", "paused", "inactive"] as const;
export const CLIENT_STATUS_LABEL: Record<(typeof CLIENT_STATUS)[number], string> = {
  lead: "Prospecção",
  active: "Ativo",
  paused: "Pausado",
  inactive: "Inativo",
};

export const clientInput = z.object({
  name: requiredText("o nome", 120),
  legalName: optionalText(200),
  document: optionalText(32),
  email: z
    .union([z.email("E-mail inválido"), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  phone: optionalText(40),
  website: optionalText(200),
  industry: optionalText(80),
  address: optionalText(300),
  status: z.enum(CLIENT_STATUS).default("active"),
  notesInternal: optionalText(5000),
  leadMembershipId: optionalUuid,
  /** Categoria da agência. Ausente = não muda (edição); "" ou null = sem categoria. */
  categoryId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
});
export type ClientInput = z.input<typeof clientInput>;

/* Categorias de clientes --------------------------------------------- */

export const CATEGORY_COLORS = LABEL_COLORS;

export const clientCategoryInput = z.object({
  id: optionalUuid,
  name: requiredText("o nome da categoria", 40),
  color: z.enum(CATEGORY_COLORS).default("slate"),
});

export const clientCategoryOrderInput = z.object({ ids: z.array(uuid).min(1).max(100) });

export const clientCategoryMoveInput = z.object({
  clientId: uuid,
  /** null = sem categoria. */
  categoryId: uuid.nullable(),
});

export const contactInput = z.object({
  id: optionalUuid,
  clientId: uuid,
  name: requiredText("o nome", 120),
  email: z
    .union([z.email("E-mail inválido"), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  phone: optionalText(40),
  position: optionalText(80),
  isPrimary: z.boolean().default(false),
  notes: optionalText(1000),
});

export const clientMembersInput = z.object({
  clientId: uuid,
  members: z
    .array(z.object({ membershipId: uuid, role: z.enum(["lead", "member"]) }))
    .max(50)
    .refine((m) => m.filter((x) => x.role === "lead").length <= 1, "Apenas um responsável principal"),
});

export const BILLING_TYPE_LABEL = { monthly: "Mensal", one_time: "Pontual", hourly: "Por hora" } as const;
export const SERVICE_STATUS_LABEL = { active: "Ativo", paused: "Pausado", ended: "Encerrado" } as const;

export const serviceInput = z.object({
  id: optionalUuid,
  clientId: uuid,
  name: requiredText("o serviço", 120),
  description: optionalText(1000),
  billingType: z.enum(["monthly", "one_time", "hourly"]).default("monthly"),
  amount: moneyCents,
  billingDay: z.coerce.number().int().min(1).max(28).optional().nullable(),
  startsOn: isoDate,
  endsOn: isoDate,
  status: z.enum(["active", "paused", "ended"]).default("active"),
});

export const brandProfileInput = z.object({
  clientId: uuid,
  toneOfVoice: optionalText(3000),
  audience: optionalText(3000),
  objectives: optionalText(3000),
  positioning: optionalText(3000),
  keywords: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  avoid: optionalText(2000),
  guidelines: optionalText(10000),
  colors: z
    .array(
      z.object({
        name: z.string().trim().max(40).default(""),
        hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida"),
        usage: z.string().trim().max(80).optional(),
      }),
    )
    .max(24)
    .default([]),
  fonts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        usage: z.string().trim().max(80).optional(),
        source: z.string().trim().max(200).optional(),
      }),
    )
    .max(12)
    .default([]),
});

export const clientListParams = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CLIENT_STATUS).optional(),
  /** id da categoria ou "none" (sem categoria). */
  category: z.union([z.uuid(), z.literal("none")]).optional(),
  archived: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
