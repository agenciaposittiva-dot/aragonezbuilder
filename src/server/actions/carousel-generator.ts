"use server";

import type { z } from "zod";
import { getActor, getSession } from "@/server/auth/session";
import type { Actor } from "@/server/authz";
import { processEventsInBackground } from "@/server/events/inline";
import {
  createCarouselVariant,
  regenerateCarouselSlide,
  regenerateSlideInput,
  restyleCarousel,
  restyleInput,
  variantInput,
} from "@/server/services/carousel-generator";
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

/** Regenera um slide com a IA (versão "Antes de regenerar…" + operações com controle de revisão). */
export const regenerateCarouselSlideAction = actorAction(regenerateSlideInput, regenerateCarouselSlide);
/** Nova direção visual mantendo os textos (sem custo de IA). */
export const restyleCarouselAction = orgAction(restyleInput, restyleCarousel, { refresh: false });
/** Segunda versão: arte nova com outra composição. */
export const carouselVariantAction = orgAction(variantInput, createCarouselVariant);
