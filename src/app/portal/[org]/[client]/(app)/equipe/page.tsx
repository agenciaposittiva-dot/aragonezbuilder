import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestsManager } from "@/components/clients/guests-manager";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { getPublishedPortal } from "@/server/services/client-portal";
import { guestRoleOptions, listClientGuests } from "@/server/services/guests";

export const metadata: Metadata = { title: "Equipe" };

/** Administrador do cliente convida colegas — só quando a agência permite. */
export default async function PortalTeamPage({ params }: PageProps<"/portal/[org]/[client]/equipe">) {
  const { org, client: clientSlug } = await params;
  const portal = await requirePortal(org, clientSlug, { permission: "portal.invite" });
  const data = await inOrg(portal.actor, async (s) => {
    const { allowGuestInvites } = await getPublishedPortal(s, portal.client.id);
    if (!allowGuestInvites) return null;
    return { guests: await listClientGuests(s, portal.client.id), roles: await guestRoleOptions(s) };
  });
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title="Equipe"
        description="Convide colegas da sua empresa para acompanhar projetos, aprovar materiais e abrir demandas."
      />
      <GuestsManager clientId={portal.client.id} data={data.guests} roles={data.roles} canManage />
    </>
  );
}
