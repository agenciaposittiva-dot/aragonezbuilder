import { FilesLibrary } from "@/components/files/files-library";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { loadFilesLibrary } from "@/server/services/files-page";
import { getProject } from "@/server/services/projects";

export default async function ProjectFilesPage({ params, searchParams }: PageProps<"/w/[org]/projects/[id]/files">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const data = await inOrg(actor, async (s) => {
    const p = await getProject(s, id);
    return {
      ...(await loadFilesLibrary(s, sp, { clientId: p.project.clientId, projectId: id })),
      clientId: p.project.clientId,
    };
  });
  return (
    <FilesLibrary
      rows={data.list.rows}
      total={data.list.total}
      page={data.list.page}
      pageSize={data.list.pageSize}
      searchParams={sp}
      basePath={`/w/${actor.orgSlug}/projects/${id}/files`}
      folders={data.folders}
      scope={{ clientId: data.clientId, projectId: id }}
      canWrite={data.canWrite}
      canDelete={data.canDelete}
      maxBytes={data.maxBytes}
    />
  );
}
