"use server";

import { z } from "zod";
import { filePatchInput, fileUpdateInput, folderInput } from "@/lib/validators/files";
import * as files from "@/server/services/files";
import { orgAction } from "./safe-action";

export const updateFileAction = orgAction(fileUpdateInput, files.updateFile);

export const setFileSharedAction = orgAction(
  z.object({ fileId: z.uuid(), shared: z.boolean() }),
  (s, { fileId, shared }) => files.setFileShared(s, fileId, shared),
);

export const toggleFavoriteAction = orgAction(z.object({ fileId: z.uuid() }), (s, { fileId }) =>
  files.toggleFavorite(s, fileId),
);

export const deleteFileAction = orgAction(
  z.object({ fileId: z.uuid(), force: z.boolean().optional() }),
  (s, { fileId, force }) => files.deleteFile(s, fileId, { force }),
);

export const patchFileAction = orgAction(filePatchInput, files.patchFile);

export const duplicateFileAction = orgAction(z.object({ fileId: z.uuid() }), (s, { fileId }) =>
  files.duplicateFile(s, fileId),
);

export const setFileArchivedAction = orgAction(
  z.object({ fileId: z.uuid(), archived: z.boolean() }),
  (s, { fileId, archived }) => files.setFileArchived(s, fileId, archived),
);

export const saveFolderAction = orgAction(folderInput, files.saveFolder);

export const deleteFolderAction = orgAction(z.object({ folderId: z.uuid() }), (s, { folderId }) =>
  files.deleteFolder(s, folderId),
);

export const setClientLogoAction = orgAction(
  z.object({ clientId: z.uuid(), fileId: z.uuid().nullable() }),
  (s, { clientId, fileId }) => files.setClientLogo(s, clientId, fileId),
);

export const setClientLogoBackgroundAction = orgAction(
  z.object({
    clientId: z.uuid(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor no formato #RRGGBB").nullable(),
  }),
  (s, { clientId, color }) => files.setClientLogoBackground(s, clientId, color),
);

export const listAttachmentsAction = orgAction(
  z.object({ taskId: z.uuid().optional(), projectId: z.uuid().optional(), requestId: z.uuid().optional() }),
  (s, target) => files.listFiles(s, { ...target, pageSize: 200 }),
  { refresh: false },
);
