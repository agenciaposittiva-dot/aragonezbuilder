"use server";

import { z } from "zod";
import { applyBreakdownInput, applyPlanInput } from "@/lib/task-ai";
import * as taskAi from "@/server/services/task-ai";
import { orgAction } from "./safe-action";

/* Dados do assistente (carregados ao abrir; não re-renderizam a página) */
export const taskAiSetupAction = orgAction(z.object({}), (s) => taskAi.taskAiSetup(s), { refresh: false });

/* Gravação: só a partir da confirmação explícita na prévia */
export const applyTaskPlanAction = orgAction(applyPlanInput, taskAi.applyTaskPlan);
export const applyTaskBreakdownAction = orgAction(applyBreakdownInput, taskAi.applyTaskBreakdown);
