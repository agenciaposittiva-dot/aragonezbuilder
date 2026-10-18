"use server";

import { z } from "zod";
import {
  compareDesignVersions,
  conflictInput,
  createNamedVersion,
  listDesignVersions,
  resolveDesignConflict,
  restoreDesignVersion,
} from "@/server/services/design-versions";
import {
  archiveDesign,
  createDesign,
  designCreateInput,
  designMetaInput,
  designSaveInput,
  duplicateDesign,
  linkDesignOutput,
  saveDesign,
  unarchiveDesign,
  updateDesignMeta,
} from "@/server/services/designs";
import { orgAction } from "./safe-action";

export const createDesignAction = orgAction(designCreateInput, createDesign);
// Salvamento automático: não re-renderiza a página a cada gravação.
export const saveDesignAction = orgAction(designSaveInput, saveDesign, { refresh: false });
export const updateDesignMetaAction = orgAction(designMetaInput, updateDesignMeta);
export const duplicateDesignAction = orgAction(z.object({ id: z.uuid(), asTemplate: z.boolean().optional() }), (s, i) =>
  duplicateDesign(s, i.id, i.asTemplate),
);
export const archiveDesignAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => archiveDesign(s, id));
export const unarchiveDesignAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => unarchiveDesign(s, id));
export const linkDesignOutputAction = orgAction(
  z.object({ designId: z.uuid(), fileId: z.uuid(), versionId: z.uuid().nullable() }),
  (s, i) => linkDesignOutput(s, i.designId, i.fileId, i.versionId),
  { refresh: false },
);

// Versões e conflitos: o editor atualiza o próprio estado, sem re-renderizar a página.
export const listDesignVersionsAction = orgAction(
  z.object({ designId: z.uuid() }),
  (s, i) => listDesignVersions(s, i.designId),
  { refresh: false },
);
export const createNamedVersionAction = orgAction(
  z.object({ designId: z.uuid(), label: z.string().max(80) }),
  createNamedVersion,
  { refresh: false },
);
export const restoreDesignVersionAction = orgAction(
  z.object({ versionId: z.uuid() }),
  (s, i) => restoreDesignVersion(s, i.versionId),
  { refresh: false },
);
export const compareDesignVersionsAction = orgAction(
  z.object({ fromId: z.uuid(), toId: z.union([z.uuid(), z.literal("current")]) }),
  (s, i) => compareDesignVersions(s, i.fromId, i.toId),
  { refresh: false },
);
export const resolveDesignConflictAction = orgAction(conflictInput, resolveDesignConflict, { refresh: false });
