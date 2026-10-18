"use server";

import { z } from "zod";
import { getActor, getSession } from "@/server/auth/session";
import type { Actor } from "@/server/authz";
import { processEventsInBackground } from "@/server/events/inline";
import {
  contentApprovalInput,
  convertContentInput,
  createConvertedContent,
  duplicateContent,
  previewTargetInput,
  previewTextsInput,
  requestContentApproval,
  savePreviewTarget,
  savePreviewTexts,
} from "@/server/services/content-preview";
import {
  automaticConversion,
  convertPreview,
  previewConvertInput,
  previewReviewInput,
  reviewPreview,
} from "@/server/services/preview-ai";
import { CONVERT_TARGETS } from "@/lib/preview-convert";
import { orgAction, toActionError, type ActionResult } from "./safe-action";

/** Chamadas à IA: a rede do provedor fica fora das transações do banco. */
function actorAction<S extends z.ZodType, R>(schema: S, handler: (actor: Actor, input: z.input<S>) => Promise<R>) {
  return async (orgSlug: string, input: z.input<S>): Promise<ActionResult<R>> => {
    try {
      const session = await getSession();
      if (!session) return { ok: false, error: "Sua sessão expirou. Entre novamente.", code: "unauthenticated" };
      const actor = await getActor(String(orgSlug));
      if (!actor) return { ok: false, error: "Acesso negado.", code: "forbidden" };
      schema.parse(input);
      const result = await handler(actor, input);
      processEventsInBackground();
      return { ok: true, data: result };
    } catch (err) {
      return toActionError(err);
    }
  };
}

export const savePreviewTargetAction = orgAction(previewTargetInput, savePreviewTarget, { refresh: false });
export const requestContentApprovalAction = orgAction(contentApprovalInput, requestContentApproval);
export const duplicateContentAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => duplicateContent(s, id), {
  refresh: false,
});
export const createConvertedContentAction = orgAction(convertContentInput, createConvertedContent, { refresh: false });

/** Legenda revisada na prévia (ou a sugerida pela IA, depois que a pessoa confirma). */
export const savePreviewTextsAction = orgAction(previewTextsInput, savePreviewTexts);

export const automaticConversionAction = orgAction(
  z.object({ contentId: z.uuid(), target: z.enum(CONVERT_TARGETS) }),
  automaticConversion,
  { refresh: false },
);
export const reviewPreviewAction = actorAction(previewReviewInput, reviewPreview);
export const convertPreviewAction = actorAction(previewConvertInput, convertPreview);
