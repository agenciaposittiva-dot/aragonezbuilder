"use server";

import { z } from "zod";
import { approvalLinkInput, decideApprovalInput, requestApprovalInput } from "@/lib/validators/approvals";
import * as approvalLinks from "@/server/services/approval-links";
import * as approvals from "@/server/services/approvals";
import { orgAction } from "./safe-action";

export const requestApprovalAction = orgAction(requestApprovalInput, approvals.requestApproval);

export const approvalTaskOptionsAction = orgAction(
  z.object({ fileId: z.uuid() }),
  (s, { fileId }) => approvals.approvalTaskOptions(s, fileId),
  { refresh: false },
);

export const decideApprovalAction = orgAction(decideApprovalInput, approvals.decideApproval);

export const cancelApprovalAction = orgAction(z.object({ approvalId: z.uuid() }), (s, { approvalId }) =>
  approvals.cancelApproval(s, approvalId),
);

/* Link de aprovação (sem conta) */
export const approvalLinkCandidatesAction = orgAction(
  z.object({ clientId: z.uuid() }),
  (s, { clientId }) => approvalLinks.approvalLinkCandidates(s, clientId),
  { refresh: false },
);
export const createApprovalLinkAction = orgAction(approvalLinkInput, approvalLinks.createApprovalLink);
export const revokeApprovalLinkAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) =>
  approvalLinks.revokeApprovalLink(s, id),
);
