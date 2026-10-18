"use server";

import { z } from "zod";
import {
  generalSettingsInput,
  portalSettingsInput,
  roleInput,
  timeSettingsInput,
  uploadSettingsInput,
} from "@/lib/validators/settings";
import { getSettings, updateOrganization, updateSettings } from "@/server/services/organizations";
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
  // Campos ausentes mantêm o valor atual (ex.: telas que não exibem todas as opções).
  const current = await getSettings(s);
  await updateSettings(s, "portal", { ...current.portal, ...portalSettingsInput.parse(raw) });
});

export const updateTimeSettingsAction = orgAction(timeSettingsInput, async (s, raw) => {
  await updateSettings(s, "time", timeSettingsInput.parse(raw));
});

const storageSettingsInput = z.object({
  /** Cota em GB; vazio = sem cota da agência (vale o limite do provedor). */
  quotaGb: z.coerce.number().positive("Use um número maior que zero").max(100_000).nullable(),
  alertPercent: z.coerce.number().int().min(50).max(99),
  designVersionRetention: z.coerce.number().int().min(5).max(500),
  versionCheckpointMinutes: z.coerce.number().int().min(1).max(240),
});

export const updateStorageSettingsAction = orgAction(storageSettingsInput, async (s, raw) => {
  const input = storageSettingsInput.parse(raw);
  await updateSettings(s, "storage", {
    quotaBytes: input.quotaGb ? Math.round(input.quotaGb * 1024 ** 3) : null,
    alertPercent: input.alertPercent,
    designVersionRetention: input.designVersionRetention,
    versionCheckpointMinutes: input.versionCheckpointMinutes,
  });
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
