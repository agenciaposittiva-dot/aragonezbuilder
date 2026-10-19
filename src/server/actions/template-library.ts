"use server";

import { z } from "zod";
import { installLibraryTemplate } from "@/server/services/template-library";
import { orgAction } from "./safe-action";

export const installLibraryTemplateAction = orgAction(z.object({ key: z.string().min(1).max(60) }), (s, i) =>
  installLibraryTemplate(s, i.key),
);
