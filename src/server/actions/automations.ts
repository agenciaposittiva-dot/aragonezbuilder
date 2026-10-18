"use server";

import { z } from "zod";
import { ruleInput } from "@/lib/validators/automations";
import * as automations from "@/server/services/automations";
import { orgAction } from "./safe-action";

export const saveRuleAction = orgAction(ruleInput, automations.saveRule);

export const setRuleEnabledAction = orgAction(z.object({ id: z.uuid(), enabled: z.boolean() }), (s, { id, enabled }) =>
  automations.setRuleEnabled(s, id, enabled),
);

export const deleteRuleAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => automations.deleteRule(s, id));
