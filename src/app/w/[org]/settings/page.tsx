import type { Metadata } from "next";
import { GeneralSettings } from "@/components/settings/general-settings";
import { OrganizationDangerZone } from "@/components/settings/organization-danger-zone";
import { StorageSettings } from "@/components/settings/storage-settings";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { env } from "@/server/env";
import { storageUsage } from "@/server/services/files";
import { getSettings } from "@/server/services/organizations";

const STORAGE_DRIVER_LABEL = {
  database: "no banco de dados (Postgres)",
  blob: "no Vercel Blob",
  s3: "em armazenamento S3",
  local: "no disco do servidor",
} as const;

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsGeneralPage({ params }: PageProps<"/w/[org]/settings">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "org.manage" });
  const [settings, usage] = await inOrg(actor, async (s) => [await getSettings(s), await storageUsage(s)] as const);
  return (
    <div className="grid gap-6">
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
      <StorageSettings
        storage={settings.storage}
        usedBytes={usage.usedBytes}
        driverLabel={STORAGE_DRIVER_LABEL[usage.driver]}
      />
      {actor.roleKey === "owner" ? <OrganizationDangerZone name={actor.orgName} slug={actor.orgSlug} /> : null}
    </div>
  );
}
