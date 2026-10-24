"use server";

import { z } from "zod";
import { getActor, getSession } from "@/server/auth/session";
import type { Actor } from "@/server/authz";
import { processEventsInBackground } from "@/server/events/inline";
import {
  anglesInput,
  createMachineProject,
  createMachineTask,
  fileSourceInput,
  generateAngles,
  linkSourceInput,
  machineAiInput,
  machineCreateInput,
  machinePlanInput,
  machineSaveInput,
  machineTaskInput,
  machineTrendOptions,
  planMachineContent,
  researchOpportunity,
  saveMachineProject,
  setFileSource,
  setLinkSource,
  setMachineArchived,
  setTrendSource,
  trendSourceInput,
} from "@/server/services/content-machine";
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

export const createMachineProjectAction = orgAction(machineCreateInput, createMachineProject);
// Salvamento automático do assistente: não re-renderiza a página a cada gravação.
export const saveMachineProjectAction = orgAction(machineSaveInput, saveMachineProject, { refresh: false });
export const archiveMachineProjectAction = orgAction(z.object({ id: z.uuid(), archived: z.boolean() }), (s, i) =>
  setMachineArchived(s, i.id, i.archived),
);
export const machineLinkSourceAction = orgAction(linkSourceInput, setLinkSource, { refresh: false });
export const machineFileSourceAction = orgAction(fileSourceInput, setFileSource, { refresh: false });
export const machineTrendSourceAction = orgAction(trendSourceInput, setTrendSource, { refresh: false });
export const machineTrendOptionsAction = orgAction(
  z.object({ q: z.string().max(120).optional() }),
  (s, i) => machineTrendOptions(s, i.q),
  { refresh: false },
);
export const machineOpportunityAction = actorAction(machineAiInput, researchOpportunity);
export const machineAnglesAction = actorAction(anglesInput, generateAngles);
export const machinePlanAction = orgAction(machinePlanInput, planMachineContent, { refresh: false });
export const machineTaskAction = orgAction(machineTaskInput, createMachineTask, { refresh: false });
