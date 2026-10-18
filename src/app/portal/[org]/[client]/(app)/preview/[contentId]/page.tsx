import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PortalPreviewView } from "@/components/preview/portal-preview";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { NotFoundError } from "@/server/errors";
import { fileApprovals } from "@/server/services/approvals";
import { getPortalPreview } from "@/server/services/content-preview";

export const metadata: Metadata = { title: "Prévia da publicação" };

export default async function PortalContentPreviewPage({
  params,
}: PageProps<"/portal/[org]/[client]/preview/[contentId]">) {
  const { org, client: clientSlug, contentId } = await params;
  const portal = await requirePortal(org, clientSlug, { permission: "files.read" });
  const data = await inOrg(portal.actor, async (s) => {
    try {
      const preview = await getPortalPreview(s, contentId);
      const rounds: Record<string, Awaited<ReturnType<typeof fileApprovals>>> = {};
      for (const id of new Set(preview.slides.map((x) => x.fileId))) rounds[id] = await fileApprovals(s, id);
      return { preview, rounds };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  return (
    <div className="grid gap-2">
      <Breadcrumbs
        items={[{ label: "Materiais", href: `${portal.base}/files` }, { label: data.preview.content.title }]}
      />
      <PortalPreviewView data={data.preview} base={portal.base} rounds={data.rounds} />
    </div>
  );
}
