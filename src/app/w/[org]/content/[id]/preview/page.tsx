import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewCenter } from "@/components/preview/preview-center";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getPickerData } from "@/server/services/ai-models";
import { getContentPreview } from "@/server/services/content-preview";

export const metadata: Metadata = { title: "Prévia da publicação" };

export default async function ContentPreviewPage({ params }: PageProps<"/w/[org]/content/[id]/preview">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "content.read" });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await inOrg(actor, async (s) => {
    try {
      const preview = await getContentPreview(s, id);
      return { preview, picker: can(actor, "ai.use") ? await getPickerData(s) : null };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  const w = `/w/${actor.orgSlug}`;
  const c = data.preview.content!;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Conteúdos", href: `${w}/content` },
          { label: c.title, href: `${w}/content/${c.id}` },
          { label: "Prévia" },
        ]}
      />
      <PreviewCenter data={data.preview} picker={data.picker} />
    </>
  );
}
