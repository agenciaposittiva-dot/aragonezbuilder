import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PortalCustomizer } from "@/components/clients/portal/portal-customizer";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getPortalAdmin, portalImageLibrary } from "@/server/services/client-portal";
import { maxUploadBytes } from "@/server/services/files";

export const metadata: Metadata = { title: "Personalização do portal" };

export default async function ClientPortalPage({ params }: PageProps<"/w/[org]/clients/[id]/portal">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      return {
        view: await getPortalAdmin(s, id),
        images: await portalImageLibrary(s, id),
        maxBytes: maxUploadBytes(s),
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");

  return (
    <PortalCustomizer
      orgSlug={actor.orgSlug}
      orgName={actor.orgName}
      origin={`${proto}://${host}`}
      view={{
        client: data.view.client,
        draft: data.view.draft,
        published: data.view.published,
        version: data.view.version,
        publishedAt: data.view.publishedAt,
        loginEnabled: data.view.loginEnabled,
        allowGuestInvites: data.view.allowGuestInvites,
        versions: data.view.versions,
      }}
      images={data.images.map((i) => ({
        id: i.id,
        name: i.name,
        versionId: i.versionId,
        width: i.width,
        height: i.height,
      }))}
      maxBytes={data.maxBytes}
      canWrite={can(actor, "clients.write")}
      canUpload={can(actor, "files.write")}
    />
  );
}
