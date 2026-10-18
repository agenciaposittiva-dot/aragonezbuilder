import type { Metadata } from "next";
import { PortalHeader } from "@/components/portal/portal-header";
import { RememberOrg, RememberPortalClient } from "@/components/shell/remember-org";
import { WorkspaceProvider } from "@/components/shell/workspace-context";
import { portalAssetUrl } from "@/lib/portal-assets";
import { portalThemeStyle } from "@/lib/portal-theme";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { getPublishedPortal } from "@/server/services/client-portal";
import { getShellCounts } from "@/server/services/shell";

export async function generateMetadata({ params }: LayoutProps<"/portal/[org]/[client]">): Promise<Metadata> {
  const { org, client } = await params;
  const portal = await requirePortal(org, client);
  const { settings, version } = await inOrg(portal.actor, (s) => getPublishedPortal(s, portal.client.id));
  const name = settings.displayName ?? portal.client.name;
  return {
    title: { default: name, template: `%s · ${name}` },
    robots: { index: false },
    ...(settings.faviconFileId ? { icons: { icon: portalAssetUrl(portal.client.id, "favicon", { v: version }) } } : {}),
  };
}

export default async function PortalLayout({ children, params }: LayoutProps<"/portal/[org]/[client]">) {
  const { org, client } = await params;
  const portal = await requirePortal(org, client, { permission: "portal.access" });
  const { actor } = portal;
  const data = await inOrg(actor, async (s) => ({
    counts: await getShellCounts(s),
    published: await getPublishedPortal(s, portal.client.id),
  }));
  const { settings, version } = data.published;
  return (
    <WorkspaceProvider
      value={{
        orgSlug: actor.orgSlug,
        orgName: actor.orgName,
        orgLogoUrl: actor.orgLogoSrc,
        userId: actor.userId,
        userName: actor.name,
        userEmail: actor.email,
        userImage: actor.image,
        membershipId: actor.membershipId,
        roleName: actor.roleName,
        kind: actor.kind,
        permissions: [...actor.permissions],
        portalBase: portal.base,
        portalClient: portal.client,
      }}
    >
      <RememberOrg slug={actor.orgSlug} />
      <RememberPortalClient orgSlug={actor.orgSlug} clientSlug={portal.client.slug} />
      <div className="min-h-dvh bg-bg text-fg" style={portalThemeStyle(settings)}>
        <PortalHeader
          unread={data.counts.unread}
          badges={data.counts.badges}
          brand={{
            name: settings.displayName ?? portal.client.name,
            logoUrl:
              settings.logoFileId || portal.clientLogoFileId
                ? portalAssetUrl(portal.client.id, "logo", { v: version })
                : null,
            orgName: actor.orgName,
            orgLogoUrl: actor.settings.portal.showAgencyLogo ? actor.orgLogoSrc : null,
          }}
          switchHref={portal.multiClient ? `/portal/${actor.orgSlug}?trocar=1` : null}
        />
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
