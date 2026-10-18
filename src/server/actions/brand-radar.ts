"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getActor, getSession } from "@/server/auth/session";
import type { Actor } from "@/server/authz";
import { processEventsInBackground } from "@/server/events/inline";
import {
  archiveRadarProfile,
  bioApprovalInput,
  bioSaveInput,
  bioTaskInput,
  bioToTask,
  chooseBioVersion,
  createRadarProfile,
  highlightActionInput,
  highlightTaskInput,
  highlightToDesign,
  highlightToTask,
  manualInput,
  profileInput,
  profileUpdateInput,
  radarSettingsInput,
  recommendationContentInput,
  recommendationDesignInput,
  recommendationTaskInput,
  recommendationToContent,
  recommendationToDesign,
  recommendationToTask,
  recommendationUpdateInput,
  saveBioVersion,
  saveManualInputs,
  sendBioForApproval,
  updateRadarProfile,
  updateRadarSettings,
  updateRecommendation,
  contentIdeaInput,
  contentIdeaToContent,
} from "@/server/services/brand-radar";
import { brandAiInput, runBrandAi } from "@/server/services/brand-radar-ai";
import { disconnectInstagram, syncInstagram } from "@/server/services/instagram";
import { orgAction, toActionError, type ActionResult } from "./safe-action";

/** Ações que chamam IA ou a API do Instagram: transações curtas antes e depois da chamada externa. */
function actorAction<S extends z.ZodType, R>(
  schema: S,
  handler: (actor: Actor, input: z.input<S>) => Promise<R>,
  options: { refresh?: boolean } = {},
) {
  return async (orgSlug: string, input: z.input<S>): Promise<ActionResult<R>> => {
    try {
      const session = await getSession();
      if (!session) return { ok: false, error: "Sua sessão expirou. Entre novamente.", code: "unauthenticated" };
      const actor = await getActor(String(orgSlug));
      if (!actor) return { ok: false, error: "Acesso negado.", code: "forbidden" };
      schema.parse(input);
      const result = await handler(actor, input);
      processEventsInBackground();
      if (options.refresh !== false) refresh();
      return { ok: true, data: result };
    } catch (err) {
      return toActionError(err);
    }
  };
}

const id = z.object({ id: z.uuid() });
const profileId = z.object({ profileId: z.uuid() });

export const createRadarProfileAction = orgAction(profileInput, createRadarProfile);
export const updateRadarProfileAction = orgAction(profileUpdateInput, updateRadarProfile);
export const archiveRadarProfileAction = orgAction(id, (s, i) => archiveRadarProfile(s, i.id));
export const saveManualInputsAction = orgAction(manualInput, saveManualInputs);
export const updateRadarSettingsAction = orgAction(radarSettingsInput, updateRadarSettings);

export const runBrandAiAction = actorAction(brandAiInput, runBrandAi);

export const updateRecommendationAction = orgAction(recommendationUpdateInput, updateRecommendation);
export const recommendationToTaskAction = orgAction(recommendationTaskInput, recommendationToTask);
export const recommendationToDesignAction = orgAction(recommendationDesignInput, recommendationToDesign);
export const recommendationToContentAction = orgAction(recommendationContentInput, recommendationToContent);
export const contentIdeaToContentAction = orgAction(contentIdeaInput, contentIdeaToContent);

export const highlightToDesignAction = orgAction(highlightActionInput, highlightToDesign);
export const highlightToTaskAction = orgAction(highlightTaskInput, highlightToTask);

export const saveBioVersionAction = orgAction(bioSaveInput, saveBioVersion);
export const chooseBioVersionAction = orgAction(id, (s, i) => chooseBioVersion(s, i.id));
export const sendBioForApprovalAction = orgAction(bioApprovalInput, sendBioForApproval);
export const bioToTaskAction = orgAction(bioTaskInput, bioToTask);

export const syncInstagramAction = actorAction(profileId, (actor, i) => syncInstagram(actor, i.profileId));
export const disconnectInstagramAction = orgAction(profileId, (s, i) => disconnectInstagram(s, i.profileId));
