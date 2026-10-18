import { z } from "zod";
import { ALL_PERMISSIONS } from "@/lib/permissions";

export const generalSettingsInput = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(80),
  logoUrl: z
    .union([z.url("Endereço inválido"), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
});

export const uploadSettingsInput = z.object({
  maxMb: z.coerce.number().int().min(1, "Mínimo 1 MB").max(5120, "Máximo 5 GB"),
  allowedTypes: z.array(z.string().trim().min(2).max(120)).min(1, "Permita pelo menos um tipo"),
});

export const portalSettingsInput = z.object({
  showInvoices: z.boolean(),
  showProjectProgress: z.boolean(),
  allowRequestCreation: z.boolean(),
});

export const timeSettingsInput = z.object({ trackingEnabled: z.boolean() });

export const roleInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Informe o nome").max(40),
  description: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  kind: z.enum(["internal", "client"]).default("internal"),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length),
});
