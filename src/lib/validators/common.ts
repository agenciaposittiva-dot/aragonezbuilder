import { z } from "zod";

/** Texto opcional: string vazia vira null. */
export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (label: string, max = 200) => z.string().trim().min(1, `Informe ${label}`).max(max);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const uuid = z.uuid("Identificador inválido");
export const optionalUuid = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const priorityEnum = z.enum(["low", "medium", "high", "urgent"]);

/** Valor monetário digitado em reais ("1.234,56" ou número) → centavos. */
export const moneyCents = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Math.round(v * 100);
    const normalized = v.replace(/[R$\s.]/g, "").replace(",", ".");
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Valor inválido" });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

export const pageParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
