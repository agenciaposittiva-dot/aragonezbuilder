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
import { orgAction } from "./safe-action";

export const togglePinGenerationAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) =>
  togglePinGeneration(s, id),
);
export const deleteGenerationAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => deleteGeneration(s, id));
export const updateAiSettingsAction = orgAction(aiSettingsInput, updateAiSettings);

export const createSuggestedTasksAction = orgAction(suggestedTasksInput, createSuggestedTasks);
