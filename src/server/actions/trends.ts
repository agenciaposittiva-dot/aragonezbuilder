"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getActor, getSession } from "@/server/auth/session";
import type { Actor } from "@/server/authz";
import { processEventsInBackground } from "@/server/events/inline";
import {
  createFromTrend,
  createFromTrendInput,
  contentImageInput,
  generateContentImage,
} from "@/server/services/content";
import {
  collectionInput,
  createCollection,
  deleteCollection,
  deleteSource,
  refreshSources,
  rssSourceInput,
  saveRssSource,
  setCollectionMembership,
  setSourceEnabled,
  setTrendState,
  trendStateInput,
} from "@/server/services/trends";
import {
  classifyInput,
  classifyTrends,
  clientFit,
  clientFitInput,
  contentPackInput,
  generateContentPack,
} from "@/server/services/trends-ai";
import { orgAction, toActionError, type ActionResult } from "./safe-action";

/**
 * Ações que chamam rede externa ou IA: não podem rodar dentro de uma única
 * transação (o serviço abre transações curtas antes e depois da chamada).
 */
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

export const refreshTrendsAction = actorAction(z.object({ sourceId: z.uuid().optional() }), (actor, { sourceId }) =>
  refreshSources(actor, { sourceId }),
);

export const saveRssSourceAction = orgAction(rssSourceInput, saveRssSource);
export const setSourceEnabledAction = orgAction(z.object({ id: z.uuid(), enabled: z.boolean() }), (s, i) =>
  setSourceEnabled(s, i.id, i.enabled),
);
export const deleteSourceAction = orgAction(id, (s, i) => deleteSource(s, i.id));

export const setTrendStateAction = orgAction(trendStateInput, setTrendState);
export const createCollectionAction = orgAction(collectionInput, createCollection);
export const deleteCollectionAction = orgAction(id, (s, i) => deleteCollection(s, i.id));
export const setCollectionMembershipAction = orgAction(
  z.object({ collectionId: z.uuid(), trendId: z.uuid(), member: z.boolean() }),
  (s, i) => setCollectionMembership(s, i.collectionId, i.trendId, i.member),
);

export const classifyTrendsAction = actorAction(classifyInput, classifyTrends);
export const clientFitAction = actorAction(clientFitInput, clientFit, { refresh: false });
export const contentPackAction = actorAction(contentPackInput, generateContentPack, { refresh: false });
export const contentImageAction = actorAction(contentImageInput, generateContentImage, { refresh: false });
export const createFromTrendAction = orgAction(createFromTrendInput, createFromTrend);
