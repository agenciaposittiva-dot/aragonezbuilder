import type { Metadata } from "next";
import Link from "next/link";
import { AiConnectionsPanel } from "@/components/account/ai-connections";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listMyConnections, myAiUsage } from "@/server/services/ai-connections";
import { getPickerData, listPreferences } from "@/server/services/ai-models";

export const metadata: Metadata = { title: "Minhas inteligências artificiais" };

/**
 * Conexões de IA pessoais (BYOK): cada pessoa conecta as próprias chaves,
 * escolhe o modelo padrão por finalidade e acompanha o próprio consumo. As
 * chaves nunca saem do servidor (só o final mascarado chega aqui).
 */
export default async function MyAiPage({ params }: PageProps<"/w/[org]/account/ai">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "ai.use" });
  const data = await inOrg(actor, async (s) => ({
    connections: await listMyConnections(s),
    picker: await getPickerData(s),
    preferences: await listPreferences(s),
    usage: await myAiUsage(s),
  }));
  return (
    <>
      <PageHeader
        title="Minhas inteligências artificiais"
        description="Conecte suas próprias chaves de IA, escolha o modelo padrão de cada finalidade e acompanhe o seu consumo. Suas chaves valem só para você, nesta organização."
        actions={
          <Button variant="secondary" asChild>
            <Link href={`/w/${actor.orgSlug}/account`}>Meu perfil</Link>
          </Button>
        }
      />
      <AiConnectionsPanel {...data} />
    </>
  );
}
