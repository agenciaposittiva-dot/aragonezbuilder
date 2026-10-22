"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import type { z } from "zod";
import type { approvalLinkDecisionInput } from "@/lib/validators/approvals";
import { processEventsInBackground } from "@/server/events/inline";
import { clientIp, consumeRateLimit } from "@/server/rate-limit";
import { decideByApprovalLink } from "@/server/services/approval-links";
import { toActionError, type ActionResult } from "./safe-action";

/**
 * Decisão pelo link de aprovação (sem sessão). O token é o que autoriza; o
 * limite por IP protege contra tentativas repetidas.
 */
export async function decideByApprovalLinkAction(
  token: string,
  input: z.input<typeof approvalLinkDecisionInput>,
): Promise<ActionResult> {
  try {
    const ip = clientIp(await headers());
    if (!(await consumeRateLimit(`approval-link:${ip}`, { windowSec: 600, max: 60 }))) {
      return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos e tente de novo.", code: "limit" };
    }
    await decideByApprovalLink(String(token), input);
    processEventsInBackground();
    refresh();
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
