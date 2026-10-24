"use server";

import { z } from "zod";
import {
  createDriveFolder,
  disconnectGoogleDrive,
  driveLinksForFile,
  driveListInput,
  driveSettingsInput,
  ensureRootFolder,
  exportToDriveInput,
  exportVersionToDrive,
  googleDriveStatus,
  importFromDrive,
  importFromDriveInput,
  listDriveFolder,
  testGoogleDrive,
  updateGoogleDriveSettings,
} from "@/server/services/google-drive";
import { orgAction } from "./safe-action";

/** Os tokens nunca saem do servidor: as ações devolvem só estado, listas e resultados. */
export const googleDriveStatusAction = orgAction(z.object({}), (s) => googleDriveStatus(s));
export const testGoogleDriveAction = orgAction(z.object({}), (s) => testGoogleDrive(s));
export const disconnectGoogleDriveAction = orgAction(z.object({}), (s) => disconnectGoogleDrive(s));
export const updateGoogleDriveSettingsAction = orgAction(driveSettingsInput, updateGoogleDriveSettings);
export const ensureDriveRootFolderAction = orgAction(z.object({}), (s) => ensureRootFolder(s));
export const listDriveFolderAction = orgAction(driveListInput, listDriveFolder);
export const createDriveFolderAction = orgAction(
  z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().trim().max(200).nullish() }),
  (s, input) => createDriveFolder(s, input),
);
export const exportVersionToDriveAction = orgAction(exportToDriveInput, exportVersionToDrive);
export const importFromDriveAction = orgAction(importFromDriveInput, importFromDrive);
export const driveLinksForFileAction = orgAction(z.object({ fileId: z.uuid() }), (s, { fileId }) =>
  driveLinksForFile(s, fileId),
);
