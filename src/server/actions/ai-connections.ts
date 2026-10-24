"use server";

import { z } from "zod";
import {
  CONNECTABLE_PROVIDERS,
  removeMyConnection,
  saveConnectionInput,
  saveMyConnection,
  setMyConnectionEnabled,
  testMyConnection,
} from "@/server/services/ai-connections";
import { setProviderUserKeysAllowed } from "@/server/services/ai-providers";
import { orgAction } from "./safe-action";

const providerId = z.enum(CONNECTABLE_PROVIDERS as [string, ...string[]]);

/** A chave nunca volta ao navegador: a resposta traz só o resultado da validação. */
export const saveMyAiConnectionAction = orgAction(saveConnectionInput, (s, input) => saveMyConnection(s, input));
export const testMyAiConnectionAction = orgAction(z.object({ provider: providerId }), (s, { provider }) =>
  testMyConnection(s, provider),
);
export const setMyAiConnectionEnabledAction = orgAction(
  z.object({ provider: providerId, enabled: z.boolean() }),
  (s, { provider, enabled }) => setMyConnectionEnabled(s, provider, enabled),
);
export const removeMyAiConnectionAction = orgAction(z.object({ provider: providerId }), (s, { provider }) =>
  removeMyConnection(s, provider),
);

/** Administração: permite ou bloqueia chaves pessoais de um provedor. */
export const setProviderUserKeysAllowedAction = orgAction(
  z.object({ provider: providerId, allowed: z.boolean() }),
  (s, { provider, allowed }) => setProviderUserKeysAllowed(s, provider, allowed),
);
