import type { Metadata } from "next";
import { FilesLibrary } from "@/components/files/files-library";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { loadCloud } from "@/server/services/files-page";

export const metadata: Metadata = { title: "Minha Nuvem" };

export default async function FilesPage({ params, searchParams }: PageProps<"/w/[org]/files">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const data = await inOrg(actor, (s) => loadCloud(s, sp));
  const base = `/w/${actor.orgSlug}`;
  return (
    <>
      <PageHeader
        title="Minha Nuvem"
        description="Todos os arquivos da agência e dos clientes, com versões, aprovações e organização por cliente — salvos no servidor, disponíveis em qualquer aparelho."
      />
      <FilesLibrary
        rows={data.list.rows}
        total={data.list.total}
        page={data.list.page}
        pageSize={data.list.pageSize}
        searchParams={sp}
        basePath={`${base}/files`}
        folders={data.folders}
        scope={{}}
        clients={data.clients}
        projects={data.projects}
        canWrite={data.canWrite}
        canDelete={data.canDelete}
        maxBytes={data.maxBytes}
        cloud={{
          usage: data.usage,
          recentDesigns: data.recentDesigns,
          trashHref: data.canDelete ? `${base}/trash` : null,
          settingsHref: can(actor, "org.manage") ? `${base}/settings#armazenamento` : null,
          studioHref: `${base}/studio`,
        }}
      />
    </>
  );
}
