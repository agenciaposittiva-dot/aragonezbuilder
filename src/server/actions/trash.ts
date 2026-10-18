"use server";

import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import {
  clientDeletionImpact,
  organizationDeletionImpact,
  projectDeletionImpact,
  purgeFromTrash,
  restoreFromTrash,
  restoreOrganization,
  trashClient,
  trashDesign,
  trashOrganization,
  trashProject,
} from "@/server/services/trash";
import { orgAction, toActionError, type ActionResult } from "./safe-action";

const id = z.object({ id: z.uuid() });
const item = z.object({ kind: z.enum(["client", "project", "design"]), id: z.uuid() });

// Consultas de impacto (para a confirmação): não re-renderizam a página.
export const clientDeletionImpactAction = orgAction(id, (s, i) => clientDeletionImpact(s, i.id), { refresh: false });
export const projectDeletionImpactAction = orgAction(id, (s, i) => projectDeletionImpact(s, i.id), { refresh: false });
export const organizationDeletionImpactAction = orgAction(z.object({}), (s) => organizationDeletionImpact(s), {
  refresh: false,
});

export const trashClientAction = orgAction(
  z.object({ id: z.uuid(), confirmFinance: z.boolean().optional() }),
  (s, i) => trashClient(s, i.id, { confirmFinance: i.confirmFinance }),
);
export const trashProjectAction = orgAction(id, (s, i) => trashProject(s, i.id));
export const trashDesignAction = orgAction(id, (s, i) => trashDesign(s, i.id));
export const restoreFromTrashAction = orgAction(item, (s, i) => restoreFromTrash(s, i.kind, i.id));
export const purgeFromTrashAction = orgAction(item, (s, i) => purgeFromTrash(s, i.kind, i.id));

export const trashOrganizationAction = orgAction(z.object({ confirmName: z.string().max(200) }), (s, i) =>
  trashOrganization(s, i.confirmName),
);

/** Restaurar uma agência é feito fora dela (ela está inacessível enquanto está na lixeira). */
export async function restoreOrganizationAction(orgId: string): Promise<ActionResult<{ slug: string; name: string }>> {
  try {
    const session = await requireSession();
    const res = await restoreOrganization(session.user.id, z.uuid().parse(orgId));
    return { ok: true, data: res };
  } catch (err) {
    return toActionError(err);
  }
}
