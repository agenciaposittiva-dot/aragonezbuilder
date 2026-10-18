"use server";

import { z } from "zod";
import { designAiOutcomeInput, designAiSetup, setDesignAiOutcome } from "@/server/services/design-ai";
import { orgAction } from "./safe-action";

// Chat de edição de artes: leituras e registros sem re-renderizar a página.
export const designAiSetupAction = orgAction(z.object({ designId: z.uuid() }), (s, i) => designAiSetup(s, i.designId), {
  refresh: false,
});
export const designAiOutcomeAction = orgAction(designAiOutcomeInput, setDesignAiOutcome, { refresh: false });
