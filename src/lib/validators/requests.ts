import { z } from "zod";
import { BRIEFING_CATEGORIES } from "./briefings";
import { isoDate, optionalText, optionalUuid, priorityEnum, requiredText, uuid } from "./common";

export const REQUEST_STATUSES = [
  "draft",
  "submitted",
  "triage",
  "in_progress",
  "delivered",
  "rejected",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Rascunho",
  submitted: "Recebida",
  triage: "Em triagem",
  in_progress: "Em produção",
  delivered: "Entregue",
  rejected: "Recusada",
  cancelled: "Cancelada",
};

/** Transições manuais permitidas (conversão em projeto é uma ação própria). */
export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["triage", "in_progress", "rejected", "cancelled"],
  triage: ["submitted", "in_progress", "rejected", "cancelled"],
  in_progress: ["triage", "delivered", "cancelled"],
  delivered: ["in_progress"],
  rejected: ["triage"],
  cancelled: ["submitted"],
};

export const requestInput = z.object({
  clientId: uuid,
  templateId: optionalUuid,
  title: requiredText("o título", 160),
  category: z.enum(BRIEFING_CATEGORIES).default("other"),
  objective: optionalText(2000),
  description: optionalText(10000),
  audience: optionalText(1000),
  channel: optionalText(200),
  format: optionalText(200),
  piecesCount: z.coerce.number().int().min(1).max(999).optional().nullable(),
  desiredDueDate: isoDate,
  priority: priorityEnum.default("medium"),
  references: optionalText(5000),
  copyText: optionalText(10000),
  briefing: z.record(z.string(), z.unknown()).default({}),
  /** Salvar como rascunho em vez de enviar. */
  draft: z.boolean().default(false),
});
export type RequestInput = z.input<typeof requestInput>;

export const requestUpdateInput = requestInput.omit({ clientId: true, draft: true }).extend({ id: uuid });

export const requestListParams = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(REQUEST_STATUSES).optional(),
  open: z.coerce.boolean().optional(),
  clientId: z.uuid().optional(),
  category: z.enum(BRIEFING_CATEGORIES).optional(),
  assigneeId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const convertRequestInput = z.object({
  requestId: uuid,
  mode: z.enum(["new", "existing"]),
  projectId: optionalUuid,
  projectName: optionalText(160),
  ownerMembershipId: optionalUuid,
  dueDate: isoDate,
});
