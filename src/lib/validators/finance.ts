import { z } from "zod";
import { moneyCents, optionalText, optionalUuid, requiredText, uuid } from "./common";

export const INVOICE_STATUS = ["draft", "open", "paid", "overdue", "cancelled"] as const;

/** Janela (dias) dos avisos e indicadores de contrato a vencer. */
export const CONTRACT_EXPIRING_DAYS = 30;
/** Opções do filtro "Término" na lista de contratos. */
export const CONTRACT_EXPIRING_OPTIONS = [30, 60, 90] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Rascunho",
  open: "Em aberto",
  paid: "Paga",
  overdue: "Vencida",
  cancelled: "Cancelada",
};

export const EXPENSE_STATUS = ["pending", "paid", "cancelled"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUS)[number];
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  pending: "A pagar",
  paid: "Paga",
  cancelled: "Cancelada",
};

export const EXPENSE_CATEGORIES = [
  "Mídia paga",
  "Freelancer",
  "Produção",
  "Software e ferramentas",
  "Banco de imagens",
  "Impressão",
  "Folha e encargos",
  "Impostos",
  "Aluguel e escritório",
  "Outros",
];

export const PAYMENT_METHODS = ["PIX", "Boleto", "Cartão", "Transferência", "Dinheiro", "Outro"];

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida");
const requiredMoney = moneyCents.refine((v) => v !== null, "Informe o valor");

export const invoiceInput = z
  .object({
    clientId: uuid,
    projectId: optionalUuid,
    clientServiceId: optionalUuid,
    description: requiredText("a descrição", 300),
    amount: requiredMoney,
    issueDate: requiredDate,
    dueDate: requiredDate,
    status: z.enum(["draft", "open"]).default("open"),
    notes: optionalText(2000),
  })
  .refine((d) => d.dueDate >= d.issueDate, {
    message: "O vencimento deve ser igual ou posterior à emissão",
    path: ["dueDate"],
  });

export const invoiceUpdateInput = z
  .object({
    id: uuid,
    clientId: uuid,
    projectId: optionalUuid,
    clientServiceId: optionalUuid,
    description: requiredText("a descrição", 300),
    amount: requiredMoney,
    issueDate: requiredDate,
    dueDate: requiredDate,
    notes: optionalText(2000),
  })
  .refine((d) => d.dueDate >= d.issueDate, {
    message: "O vencimento deve ser igual ou posterior à emissão",
    path: ["dueDate"],
  });

export const invoiceTransitionInput = z.object({
  id: uuid,
  action: z.enum(["issue", "cancel", "reopen"]),
});

export const markInvoicePaidInput = z.object({
  id: uuid,
  paidAt: requiredDate,
  paymentMethod: z.string().trim().max(40).optional().nullable(),
});

export const invoiceListParams = z.object({
  status: z.enum(INVOICE_STATUS).optional(),
  clientId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const expenseInput = z.object({
  id: optionalUuid,
  clientId: optionalUuid,
  projectId: optionalUuid,
  category: requiredText("a categoria", 60),
  supplier: optionalText(120),
  description: requiredText("a descrição", 300),
  amount: requiredMoney,
  dueDate: requiredDate,
  status: z.enum(EXPENSE_STATUS).default("pending"),
  paidAt: z
    .union([requiredDate, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
});

export const expenseListParams = z.object({
  status: z.enum(EXPENSE_STATUS).optional(),
  category: z.string().max(60).optional(),
  projectId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const profitabilityParams = z.object({
  by: z.enum(["project", "client"]).default("project"),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
