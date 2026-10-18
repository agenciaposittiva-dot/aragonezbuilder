import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignEditor } from "@/components/studio/editor";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getBrandProfile } from "@/server/services/clients";
import { getDesign } from "@/server/services/designs";

export const metadata: Metadata = { title: "Editor de artes" };

export default async function DesignEditorPage({ params }: PageProps<"/w/[org]/studio/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "designs.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      const d = await getDesign(s, id);
      const brand = d.design.clientId ? await getBrandProfile(s, d.design.clientId) : null;
      return { d, brand };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { design, clientName } = data.d;
  const canWrite = can(actor, "designs.write") && (!design.isTemplate || can(actor, "templates.manage"));
  return (
    <DesignEditor
      canWrite={canWrite}
      canManageTemplates={can(actor, "templates.manage")}
      brand={data.brand ? { colors: data.brand.colors, fonts: data.brand.fonts } : null}
      design={{
        id: design.id,
        name: design.name,
        width: design.width,
        height: design.height,
        document: design.document,
        revision: design.revision,
        isTemplate: design.isTemplate,
        clientId: design.clientId,
        projectId: design.projectId,
        taskId: design.taskId,
        outputFileId: design.outputFileId,
        clientName,
      }}
    />
  );
}
