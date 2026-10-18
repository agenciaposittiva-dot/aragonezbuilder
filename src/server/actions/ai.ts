"use server";

import { z } from "zod";
import {
  aiSettingsInput,
  createSuggestedTasks,
  deleteGeneration,
  suggestedTasksInput,
  togglePinGeneration,
  updateAiSettings,
} from "@/server/services/ai";
import { aiPreferenceInput, deletePreference, setPreference } from "@/server/services/ai-models";
import {
  removeProviderKey,
  saveProviderKey,
  setProviderEnabled,
  validateProvider,
} from "@/server/services/ai-providers";
import { orgAction } from "./safe-action";

export const togglePinGenerationAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) =>
  togglePinGeneration(s, id),
);
export const deleteGenerationAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => deleteGeneration(s, id));
export const updateAiSettingsAction = orgAction(aiSettingsInput, updateAiSettings);

export const createSuggestedTasksAction = orgAction(suggestedTasksInput, createSuggestedTasks);

const providerId = z.enum(["anthropic", "openai", "gemini", "demo"]);

/** A chave nunca volta para o navegador: a resposta traz só o resultado da validação. */
export const saveProviderKeyAction = orgAction(
  z.object({ provider: providerId, apiKey: z.string().trim().min(1).max(400) }),
  (s, { provider, apiKey }) => saveProviderKey(s, provider, apiKey),
);
export const removeProviderKeyAction = orgAction(z.object({ provider: providerId }), (s, { provider }) =>
  removeProviderKey(s, provider),
);
export const validateProviderAction = orgAction(z.object({ provider: providerId }), (s, { provider }) =>
  validateProvider(s, provider),
);
export const setProviderEnabledAction = orgAction(
  z.object({ provider: providerId, enabled: z.boolean() }),
  (s, { provider, enabled }) => setProviderEnabled(s, provider, enabled),
);

export const setAiPreferenceAction = orgAction(aiPreferenceInput, setPreference);
export const deleteAiPreferenceAction = orgAction(
  z.object({
    scope: z.enum(["org", "user"]),
    module: z.string().max(40).default(""),
    task: z.string().max(40).default(""),
  }),
  deletePreference,
);
