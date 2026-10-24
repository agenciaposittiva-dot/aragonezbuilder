import type { Metadata } from "next";
import Link from "next/link";
import { GoogleDrivePanel } from "@/components/account/google-drive-panel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { googleDriveStatus } from "@/server/services/google-drive";

export const metadata: Metadata = { title: "Armazenamento e integrações" };

/**
 * Integrações por pessoa: Google Drive (OAuth 2.0 oficial). A conexão
 * pertence a quem autorizou; tokens ficam criptografados no servidor.
 */
export default async function IntegrationsPage({ params, searchParams }: PageProps<"/w/[org]/account/integrations">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "files.write" });
  const drive = await inOrg(actor, (s) => googleDriveStatus(s));
  const notice =
    sp.drive === "connected"
      ? { tone: "success" as const, text: "Conta Google conectada." }
      : sp.drive === "error"
        ? { tone: "danger" as const, text: typeof sp.msg === "string" ? sp.msg : "Não foi possível conectar." }
        : null;
  return (
    <>
      <PageHeader
        title="Armazenamento e integrações"
        description="Escolha onde os seus arquivos novos vão parar e conecte serviços externos. Cada conexão é sua; outra pessoa não usa a sua conta."
        actions={
          <Button variant="secondary" asChild>
            <Link href={`/w/${actor.orgSlug}/account`}>Meu perfil</Link>
          </Button>
        }
      />
      <GoogleDrivePanel status={drive} orgSlug={actor.orgSlug} notice={notice} />
    </>
  );
}
