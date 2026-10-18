import { FilesLibrary } from "@/components/files/files-library";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { loadFilesLibrary } from "@/server/services/files-page";

export default async function ClientFilesPage({ params, searchParams }: PageProps<"/w/[org]/clients/[id]/files">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const data = await inOrg(actor, (s) => loadFilesLibrary(s, sp, { clientId: id }));
  return (
    <FilesLibrary
      rows={data.list.rows}
      total={data.list.total}
      page={data.list.page}
      pageSize={data.list.pageSize}
      searchParams={sp}
      basePath={`/w/${actor.orgSlug}/clients/${id}/files`}
      folders={data.folders}
      scope={{ clientId: id }}
      projects={data.projects}
      canWrite={data.canWrite}
      canDelete={data.canDelete}
      maxBytes={data.maxBytes}
    />
  );
}
