"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { toActionError, type ActionResult } from "@/server/actions/safe-action";
import { acceptInvitation } from "@/server/services/invitations";

export async function acceptInvitationAction(token: string): Promise<ActionResult<never>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Entre na sua conta para aceitar o convite.", code: "unauthenticated" };
  let destination: string;
  try {
    const res = await acceptInvitation(String(token), { id: session.user.id, email: session.user.email });
    destination = res.kind === "client" ? `/portal/${res.slug}` : `/w/${res.slug}`;
  } catch (err) {
    return toActionError(err);
  }
  redirect(destination);
}
