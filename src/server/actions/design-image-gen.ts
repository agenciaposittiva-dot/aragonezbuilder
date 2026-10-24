"use server";

import { z } from "zod";
import { getActor, getSession } from "@/server/auth/session";
import { processEventsInBackground } from "@/server/events/inline";
import { ModelSelectionError, type ModelAlternative } from "@/server/services/ai-models";
import {
  enhanceImagePrompt,
  enhanceImagePromptInput,
  listGeneratedImages,
  type EnhancedImagePrompt,
} from "@/server/services/design-image-gen";
import { orgAction, toActionError, type ActionResult } from "./safe-action";

/** Modelo indisponível ou incompatível: a interface oferece as alternativas (nunca troca em silêncio). */
export type EnhanceImagePromptResult =
  | ActionResult<EnhancedImagePrompt>
  | { ok: false; error: string; code: "model_selection"; reason: string; alternatives: ModelAlternative[] };

/**
 * Gerar imagem (editor): melhora a descrição com o modelo de texto escolhido
 * pela pessoa (ou o padrão da tarefa), preservando a intenção. Chamada à IA
 * fora de uma transação única (o serviço abre transações curtas).
 */
export async function enhanceImagePromptAction(
  orgSlug: string,
  input: z.input<typeof enhanceImagePromptInput>,
): Promise<EnhanceImagePromptResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: "Sua sessão expirou. Entre novamente.", code: "unauthenticated" };
    const actor = await getActor(String(orgSlug));
    if (!actor) return { ok: false, error: "Acesso negado.", code: "forbidden" };
    enhanceImagePromptInput.parse(input);
    const result = await enhanceImagePrompt(actor, input);
    processEventsInBackground();
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof ModelSelectionError) {
      return {
        ok: false,
        error: err.message,
        code: "model_selection",
        reason: err.reason,
        alternatives: err.alternatives,
      };
    }
    return toActionError(err);
  }
}

/** Imagens geradas por IA disponíveis para a arte (reutilizar sem gerar de novo). */
export const generatedImagesAction = orgAction(
  z.object({ designId: z.uuid(), page: z.number().int().min(1).max(500).optional() }),
  (s, i) => listGeneratedImages(s, i),
  { refresh: false },
);
