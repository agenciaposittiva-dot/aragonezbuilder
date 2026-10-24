import type { Metadata } from "next";
import { DriveBrowser } from "@/components/files/drive-browser";
import { LibraryTabs } from "@/components/files/library-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { googleDriveStatus } from "@/server/services/google-drive";
import { projectOptions } from "@/server/services/projects";

export const metadata: Metadata = { title: "Google Drive" };

/** Biblioteca → Google Drive: navegar, buscar e importar do Drive da própria pessoa. */
export default async function GoogleDriveLibraryPage({ params }: PageProps<"/w/[org]/files/google-drive">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const base = `/w/${actor.orgSlug}`;
  const data = await inOrg(actor, async (s) => ({
    status: await googleDriveStatus(s),
    clients: await clientOptions(s),
    projects: (await projectOptions(s)).map((p) => ({ id: p.id, name: p.name, clientId: p.clientId })),
  }));
  return (
    <>
      <PageHeader
        title="Google Drive"
        description="Pastas e arquivos do seu Google Drive que a plataforma pode acessar. Importe para a biblioteca ou envie arquivos daqui para lá; cada pessoa usa a própria conta."
      >
        <LibraryTabs base={base} />
      </PageHeader>
      <DriveBrowser status={data.status} orgSlug={actor.orgSlug} clients={data.clients} projects={data.projects} />
    </>
  );
}
