"use server";

import { z } from "zod";
import { getActor, getSession } from "@/server/auth/session";
import type { Actor } from "@/server/authz";
import { processEventsInBackground } from "@/server/events/inline";
import { enhanceImagePrompt, enhanceImagePromptInput, listGeneratedImages } from "@/server/services/design-image-gen";
import { orgAction, toActionError, type ActionResult } from "./safe-action";

/** Chamada à IA fora de uma transação única (o serviço abre transações curtas). */
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

/** Gerar imagem (editor): melhora a descrição com um modelo de texto, preservando a intenção. */
export const enhanceImagePromptAction = actorAction(enhanceImagePromptInput, enhanceImagePrompt);

/** Imagens geradas por IA disponíveis para a arte (reutilizar sem gerar de novo). */
export const generatedImagesAction = orgAction(
  z.object({ designId: z.uuid(), page: z.number().int().min(1).max(500).optional() }),
  (s, i) => listGeneratedImages(s, i),
  { refresh: false },
);
