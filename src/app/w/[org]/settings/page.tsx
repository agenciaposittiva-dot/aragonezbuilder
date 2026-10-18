import type { Metadata } from "next";
import { GeneralSettings } from "@/components/settings/general-settings";
import { OrganizationDangerZone } from "@/components/settings/organization-danger-zone";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { env } from "@/server/env";
import { getSettings } from "@/server/services/organizations";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsGeneralPage({ params }: PageProps<"/w/[org]/settings">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "org.manage" });
  const settings = await inOrg(actor, getSettings);
  return (
    <div className="grid gap-6">
      <GeneralSettings
        org={{ name: actor.orgName, logoUrl: actor.orgLogoUrl, slug: actor.orgSlug }}
        uploads={settings.uploads}
        portal={settings.portal}
        time={settings.time}
        maxServerMb={Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)}
      />
      {actor.roleKey === "owner" ? <OrganizationDangerZone name={actor.orgName} slug={actor.orgSlug} /> : null}
    </div>
  );
}
