import type { Metadata } from "next";
import { PortalHeader } from "@/components/portal/portal-header";
import { RememberOrg } from "@/components/shell/remember-org";
import { WorkspaceProvider } from "@/components/shell/workspace-context";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getShellCounts } from "@/server/services/shell";

export const metadata: Metadata = { title: { default: "Área do cliente", template: "%s · Área do cliente" } };

export default async function PortalLayout({ children, params }: LayoutProps<"/portal/[org]">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "client", permission: "portal.access" });
  const counts = await inOrg(actor, getShellCounts);
  return (
    <WorkspaceProvider
      value={{
        orgSlug: actor.orgSlug,
        orgName: actor.orgName,
        orgLogoUrl: actor.orgLogoUrl,
        userId: actor.userId,
        userName: actor.name,
        userEmail: actor.email,
        userImage: actor.image,
        membershipId: actor.membershipId,
        roleName: actor.roleName,
        kind: actor.kind,
        permissions: [...actor.permissions],
      }}
    >
      <RememberOrg slug={actor.orgSlug} />
      <PortalHeader unread={counts.unread} badges={counts.badges} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </WorkspaceProvider>
  );
}
