"use server";

import { z } from "zod";
import {
  generalSettingsInput,
  portalSettingsInput,
  roleInput,
  timeSettingsInput,
  uploadSettingsInput,
} from "@/lib/validators/settings";
import { updateOrganization, updateSettings } from "@/server/services/organizations";
import { deleteRole, resetRole, saveRole } from "@/server/services/roles";
import {
  deleteStatus,
  reorderStatuses,
  saveStatus,
  setDefaultStatus,
  setTransitions,
  statusInput,
} from "@/server/services/workflow";
import { orgAction } from "./safe-action";

export const updateGeneralSettingsAction = orgAction(generalSettingsInput, (s, input) => updateOrganization(s, input));

export const updateUploadSettingsAction = orgAction(uploadSettingsInput, async (s, raw) => {
  const input = uploadSettingsInput.parse(raw);
  await updateSettings(s, "uploads", { maxBytes: input.maxMb * 1024 * 1024, allowedTypes: input.allowedTypes });
});

export const updatePortalSettingsAction = orgAction(portalSettingsInput, async (s, raw) => {
  await updateSettings(s, "portal", portalSettingsInput.parse(raw));
});

export const updateTimeSettingsAction = orgAction(timeSettingsInput, async (s, raw) => {
  await updateSettings(s, "time", timeSettingsInput.parse(raw));
});

export const saveRoleAction = orgAction(roleInput, saveRole);
export const deleteRoleAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => deleteRole(s, id));
export const resetRoleAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => resetRole(s, id));

export const saveStatusAction = orgAction(statusInput, saveStatus);
export const deleteStatusAction = orgAction(z.object({ entity: z.enum(["project", "task"]), id: z.uuid() }), (s, i) =>
  deleteStatus(s, i.entity, i.id),
);
export const reorderStatusesAction = orgAction(
  z.object({ entity: z.enum(["project", "task"]), orderedIds: z.array(z.uuid()).max(50) }),
  (s, i) => reorderStatuses(s, i.entity, i.orderedIds),
);
export const setDefaultStatusAction = orgAction(
  z.object({ entity: z.enum(["project", "task"]), id: z.uuid() }),
  (s, i) => setDefaultStatus(s, i.entity, i.id),
);
export const setTransitionsAction = orgAction(
  z.object({ fromStatusId: z.uuid(), toStatusIds: z.array(z.uuid()).max(50) }),
  (s, i) => setTransitions(s, i.fromStatusId, i.toStatusIds),
);
