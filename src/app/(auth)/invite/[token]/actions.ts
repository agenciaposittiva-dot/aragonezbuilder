"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signUpWithInvitation } from "@/server/auth/invited-signup";
import { getSession } from "@/server/auth/session";
import { toActionError, type ActionResult } from "@/server/actions/safe-action";
import { processEventsInBackground } from "@/server/events/inline";
import { acceptInvitation } from "@/server/services/invitations";

const destinationFor = (res: { slug: string; kind: "internal" | "client" }) =>
  res.kind === "client" ? `/portal/${res.slug}` : `/w/${res.slug}`;

export async function acceptInvitationAction(token: string): Promise<ActionResult<never>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Entre na sua conta para aceitar o convite.", code: "unauthenticated" };
  let destination: string;
  try {
    const res = await acceptInvitation(String(token), { id: session.user.id, email: session.user.email });
    processEventsInBackground();
    destination = destinationFor(res);
  } catch (err) {
    return toActionError(err);
  }
  redirect(destination);
}

/** Cria a conta com o e-mail do convite, aceita o convite e entra (tudo validado no servidor). */
export async function signUpWithInvitationAction(input: {
  token: string;
  name: string;
  password: string;
}): Promise<ActionResult<never>> {
  let destination: string;
  try {
    const res = await signUpWithInvitation(
      String(input?.token ?? ""),
      { name: String(input?.name ?? ""), password: String(input?.password ?? "") },
      await headers(),
    );
    processEventsInBackground();
    destination = destinationFor(res);
  } catch (err) {
    return toActionError(err);
  }
  redirect(destination);
}
