"use server";

import { z } from "zod";
import { clientAccessInput, invitationInput, memberStatusInput, memberUpdateInput } from "@/lib/validators/team";
import * as invitations from "@/server/services/invitations";
import * as team from "@/server/services/team";
import { orgAction } from "./safe-action";

export const updateMemberAction = orgAction(memberUpdateInput, team.updateMember);

export const setMemberStatusAction = orgAction(memberStatusInput, team.setMemberStatus);

export const setClientAccessAction = orgAction(clientAccessInput, team.setClientAccess);

export const createInvitationAction = orgAction(invitationInput, invitations.createInvitation);

export const revokeInvitationAction = orgAction(z.object({ id: z.uuid() }), (s, i) =>
  invitations.revokeInvitation(s, i.id),
);

export const resendInvitationAction = orgAction(
  z.object({ id: z.uuid(), validityDays: z.number().int().min(1).max(30).optional() }),
  (s, i) => invitations.resendInvitation(s, i.id, i.validityDays),
);
