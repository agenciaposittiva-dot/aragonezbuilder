import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PreviewCenter } from "@/components/preview/preview-center";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getPickerData } from "@/server/services/ai-models";
import { contentsForDesign, getDesignPreview } from "@/server/services/content-preview";

export const metadata: Metadata = { title: "Prévia da arte" };

/** Prévia de uma arte do Estúdio. Ligada a uma peça de conteúdo, abre a prévia completa da peça. */
export default async function DesignPreviewPage({ params, searchParams }: PageProps<"/w/[org]/studio/[id]/preview">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "designs.read" });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await inOrg(actor, async (s) => {
    try {
      const contents = can(actor, "content.read") ? await contentsForDesign(s, id) : [];
      if (contents.length === 1 && sp.arte !== "1") return { redirect: contents[0]!.id } as const;
      const preview = await getDesignPreview(s, id);
      return { preview, contents, picker: can(actor, "ai.use") ? await getPickerData(s) : null } as const;
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  const w = `/w/${actor.orgSlug}`;
  if ("redirect" in data) redirect(`${w}/content/${data.redirect}/preview`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Estúdio", href: `${w}/studio` },
          { label: data.preview.design!.name, href: `${w}/studio/${id}` },
          { label: "Prévia" },
        ]}
      />
      {data.contents.length > 1 ? (
        <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          Esta arte está em {data.contents.length} peças de conteúdo. Para ver com a legenda, abra a prévia de uma
          delas:{" "}
          {data.contents.map((c, i) => (
            <span key={c.id}>
              {i ? ", " : ""}
              <Link href={`${w}/content/${c.id}/preview`} className="text-accent-text hover:underline">
                {c.title}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
      <PreviewCenter data={data.preview} picker={data.picker} />
    </>
  );
}
