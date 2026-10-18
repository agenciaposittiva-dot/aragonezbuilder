import type { Metadata } from "next";
import { GeneralSettings } from "@/components/settings/general-settings";
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
    <GeneralSettings
      org={{
        name: actor.orgName,
        logoUrl: actor.orgLogoUrl,
        logoSrc: actor.orgLogoSrc,
        hasUploadedLogo: !!actor.orgLogoSrc && actor.orgLogoSrc !== actor.orgLogoUrl,
        slug: actor.orgSlug,
      }}
      logoMaxBytes={env.LOGO_MAX_BYTES}
      uploads={settings.uploads}
      portal={settings.portal}
      time={settings.time}
      maxServerMb={Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)}
    />
  );
}
