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
  applyDesignOperations,
  archiveDesign,
  createDesign,
  designCreateInput,
  designMetaInput,
  designOpsInput,
  designSaveInput,
  duplicateDesign,
  linkDesignOutput,
  saveDesign,
  templatePagesForDesign,
  templatesForDesign,
  toggleDesignFavorite,
  unarchiveDesign,
  updateDesignMeta,
} from "@/server/services/designs";
import { listFiles } from "@/server/services/files";
import { orgAction } from "./safe-action";

export const createDesignAction = orgAction(designCreateInput, createDesign);
// Salvamento automático: não re-renderiza a página a cada gravação.
export const saveDesignAction = orgAction(designSaveInput, saveDesign, { refresh: false });
export const updateDesignMetaAction = orgAction(designMetaInput, updateDesignMeta);
export const duplicateDesignAction = orgAction(z.object({ id: z.uuid(), asTemplate: z.boolean().optional() }), (s, i) =>
  duplicateDesign(s, i.id, i.asTemplate),
);
export const archiveDesignAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => archiveDesign(s, id));
/** Favorito da pessoa (modelos e artes): a página é atualizada para refletir filtros e ordem. */
export const toggleDesignFavoriteAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) =>
  toggleDesignFavorite(s, id),
);
export const unarchiveDesignAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => unarchiveDesign(s, id));
export const linkDesignOutputAction = orgAction(
  z.object({
    designId: z.uuid(),
    fileId: z.uuid(),
    versionId: z.uuid().nullable(),
    /** false = arquivo de uma página que não é a primeira (não substitui o arquivo da arte). */
    primary: z.boolean().optional(),
    label: z.string().max(80).optional(),
  }),
  (s, i) => linkDesignOutput(s, i.designId, i.fileId, i.versionId, { primary: i.primary, label: i.label }),
  { refresh: false },
);

/** Lote de operações com controle de revisão (prévia com dryRun). Base do chat de edição por IA. */
export const applyDesignOperationsAction = orgAction(designOpsInput, applyDesignOperations, { refresh: false });

// Painéis do editor (Modelos e Imagens): leituras sem re-renderizar a página.
export const designTemplatesAction = orgAction(
  z.object({ designId: z.uuid() }),
  (s, i) => templatesForDesign(s, i.designId),
  { refresh: false },
);
export const templatePagesAction = orgAction(
  z.object({ designId: z.uuid(), templateId: z.uuid() }),
  (s, i) => templatePagesForDesign(s, i.templateId, i.designId),
  { refresh: false },
);
export const designImagesAction = orgAction(
  z.object({
    clientId: z.uuid().nullable().optional(),
    q: z.string().max(120).optional(),
    page: z.number().int().min(1).max(500).optional(),
  }),
  async (s, i) => {
    const res = await listFiles(s, {
      type: "image",
      clientId: i.clientId ?? undefined,
      q: i.q || undefined,
      page: i.page ?? 1,
      pageSize: 48,
    });
    return {
      total: res.total,
      page: res.page,
      rows: res.rows
        .filter((r) => r.versionId)
        .map((r) => ({
          fileId: r.id,
          versionId: r.versionId!,
          name: r.name,
          width: r.width,
          height: r.height,
          hasThumbnail: r.hasThumbnail,
          clientName: r.clientName,
          category: r.category,
        })),
    };
  },
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
