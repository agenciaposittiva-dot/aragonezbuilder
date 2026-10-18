import { z } from "zod";
import { isoDate, optionalText, optionalUuid, uuid } from "./common";

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
