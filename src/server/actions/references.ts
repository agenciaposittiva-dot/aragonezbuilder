"use server";

import { z } from "zod";
import { referenceInput } from "@/lib/validators/files";
import * as references from "@/server/services/references";
import { orgAction } from "./safe-action";

export const saveReferenceAction = orgAction(referenceInput, references.saveReference);
export const deleteReferenceAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) =>
  references.deleteReference(s, id),
);
