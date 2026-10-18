"use server";

import { z } from "zod";
import { fileUpdateInput, folderInput } from "@/lib/validators/files";
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

export const deleteFileAction = orgAction(z.object({ fileId: z.uuid() }), (s, { fileId }) =>
  files.deleteFile(s, fileId),
);

export const saveFolderAction = orgAction(folderInput, files.saveFolder);

export const deleteFolderAction = orgAction(z.object({ folderId: z.uuid() }), (s, { folderId }) =>
  files.deleteFolder(s, folderId),
);

export const setClientLogoAction = orgAction(
  z.object({ clientId: z.uuid(), fileId: z.uuid().nullable() }),
  (s, { clientId, fileId }) => files.setClientLogo(s, clientId, fileId),
);

export const listAttachmentsAction = orgAction(
  z.object({ taskId: z.uuid().optional(), projectId: z.uuid().optional(), requestId: z.uuid().optional() }),
  (s, target) => files.listFiles(s, { ...target, pageSize: 200 }),
  { refresh: false },
);
