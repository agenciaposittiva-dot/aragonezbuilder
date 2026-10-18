import type { Metadata } from "next";
import { FilesLibrary } from "@/components/files/files-library";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { loadFilesLibrary } from "@/server/services/files-page";

export const metadata: Metadata = { title: "Arquivos" };

export default async function FilesPage({ params, searchParams }: PageProps<"/w/[org]/files">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const data = await inOrg(actor, (s) => loadFilesLibrary(s, sp));
  return (
    <>
      <PageHeader
        title="Arquivos"
        description="Peças, referências, documentos e materiais de marca, com versões e aprovações."
      />
      <FilesLibrary
        rows={data.list.rows}
        total={data.list.total}
        page={data.list.page}
        pageSize={data.list.pageSize}
        searchParams={sp}
        basePath={`/w/${actor.orgSlug}/files`}
        folders={data.folders}
        scope={{}}
        clients={data.clients}
        projects={data.projects}
        canWrite={data.canWrite}
        maxBytes={data.maxBytes}
      />
    </>
  );
}
