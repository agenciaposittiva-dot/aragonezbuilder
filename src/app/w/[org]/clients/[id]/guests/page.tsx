import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestsManager } from "@/components/clients/guests-manager";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { guestRoleOptions, listClientGuests } from "@/server/services/guests";

export const metadata: Metadata = { title: "Convidados" };

export default async function ClientGuestsPage({ params }: PageProps<"/w/[org]/clients/[id]/guests">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "members.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      return { guests: await listClientGuests(s, id), roles: await guestRoleOptions(s) };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  return <GuestsManager clientId={id} data={data.guests} roles={data.roles} canManage={can(actor, "members.manage")} />;
}
