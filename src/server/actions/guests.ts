"use server";

import { z } from "zod";
import * as guests from "@/server/services/guests";
import { orgAction } from "./safe-action";

const ids = z.object({ clientId: z.uuid(), invitationId: z.uuid() });

export const inviteGuestAction = orgAction(guests.guestInviteInput, guests.inviteGuest);

export const resendGuestInvitationAction = orgAction(
  ids.extend({ validityDays: z.number().int().min(1).max(30).optional() }),
  (s, i) => guests.resendGuestInvitation(s, i.clientId, i.invitationId, i.validityDays),
);

export const revokeGuestInvitationAction = orgAction(ids, (s, i) =>
  guests.revokeGuestInvitation(s, i.clientId, i.invitationId),
);

export const changeGuestRoleAction = orgAction(
  z.object({ clientId: z.uuid(), membershipId: z.uuid(), roleId: z.uuid() }),
  (s, i) => guests.changeGuestRole(s, i.clientId, i.membershipId, i.roleId),
);

export const removeGuestAccessAction = orgAction(z.object({ clientId: z.uuid(), membershipId: z.uuid() }), (s, i) =>
  guests.removeGuestAccess(s, i.clientId, i.membershipId),
);
