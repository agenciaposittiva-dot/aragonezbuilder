import { z } from "zod";
import { isoDate, optionalText, optionalUuid, requiredText, uuid } from "./common";

export const APPROVAL_STAGE_LABEL = { internal: "Revisão interna", client: "Aprovação do cliente" } as const;
export const APPROVAL_STATUS_LABEL = {
  pending: "Pendente",
  approved: "Aprovado",
  changes_requested: "Ajustes solicitados",
  superseded: "Substituída por nova versão",
  cancelled: "Cancelada",
} as const;

export const requestApprovalInput = z.object({
  fileId: uuid,
  /** Se omitido, usa a versão atual do arquivo. */
  versionId: optionalUuid,
  stage: z.enum(["internal", "client"]),
  message: optionalText(2000),
  dueDate: isoDate,
  taskId: optionalUuid,
  /** Leva a tarefa vinculada para o status de revisão da etapa (Revisão interna / Aprovação do cliente). */
  moveTaskToReview: z.boolean().optional(),
});

export const decideApprovalInput = z.object({
  approvalId: uuid,
  decision: z.enum(["approved", "changes_requested"]),
  note: optionalText(4000),
});

export const approvalListParams = z.object({
  tab: z.enum(["internal", "client", "decided"]).default("internal"),
  projectId: z.uuid().optional(),
  clientId: z.uuid().optional(),
});

/* Link de aprovação (sem conta) ------------------------------------- */

export const APPROVAL_LINK_DAYS = { min: 1, max: 30, default: 7 } as const;

export const approvalLinkInput = z.object({
  clientId: uuid,
  fileIds: z.array(uuid).min(1, "Escolha ao menos um arquivo").max(60, "No máximo 60 arquivos por link"),
  label: requiredText("o nome do link", 80),
  days: z.coerce
    .number()
    .int()
    .min(APPROVAL_LINK_DAYS.min, "Validade mínima de 1 dia")
    .max(APPROVAL_LINK_DAYS.max, "Validade máxima de 30 dias")
    .default(APPROVAL_LINK_DAYS.default),
});

export const approvalLinkDecisionInput = z
  .object({
    fileId: uuid,
    decision: z.enum(["approved", "changes_requested"]),
    note: optionalText(2000),
    name: z.string().trim().min(2, "Informe seu nome").max(80),
  })
  .refine((d) => d.decision === "approved" || !!d.note, {
    message: "Descreva os ajustes necessários",
    path: ["note"],
  });
