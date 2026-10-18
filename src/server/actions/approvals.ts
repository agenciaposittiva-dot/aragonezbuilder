"use server";

import { z } from "zod";
import { decideApprovalInput, requestApprovalInput } from "@/lib/validators/approvals";
import * as approvals from "@/server/services/approvals";
import { orgAction } from "./safe-action";

export const requestApprovalAction = orgAction(requestApprovalInput, approvals.requestApproval);

export const decideApprovalAction = orgAction(decideApprovalInput, approvals.decideApproval);

export const cancelApprovalAction = orgAction(z.object({ approvalId: z.uuid() }), (s, { approvalId }) =>
  approvals.cancelApproval(s, approvalId),
);
