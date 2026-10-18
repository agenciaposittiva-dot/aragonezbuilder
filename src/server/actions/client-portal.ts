"use server";

import { z } from "zod";
import {
  publishPortal,
  restorePortalDraft,
  savePortalDraft,
  updatePortalAccess,
} from "@/server/services/client-portal";
import { orgAction } from "./safe-action";

const clientRef = z.object({ clientId: z.uuid() });

// O serviço valida e normaliza as configurações (schema em src/lib/portal-settings.ts).
export const savePortalDraftAction = orgAction(
  clientRef.extend({ settings: z.record(z.string(), z.unknown()) }),
  (s, i) => savePortalDraft(s, i.clientId, i.settings),
  { refresh: false },
);
export const publishPortalAction = orgAction(clientRef, (s, i) => publishPortal(s, i.clientId));
export const restorePortalDraftAction = orgAction(
  clientRef.extend({ version: z.number().int().positive().optional() }),
  (s, i) => restorePortalDraft(s, i.clientId, i.version),
  { refresh: false },
);
export const updatePortalAccessAction = orgAction(
  clientRef.extend({ slug: z.string(), loginEnabled: z.boolean(), allowGuestInvites: z.boolean() }),
  (s, { clientId, ...rest }) => updatePortalAccess(s, clientId, rest),
);
