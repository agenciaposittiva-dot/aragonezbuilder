import type { Metadata } from "next";
import { PasswordForm } from "@/components/account/password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { SessionsList } from "@/components/account/sessions-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Minha conta" };

export default async function PortalAccountPage({ params }: PageProps<"/portal/[org]/account">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "client" });
  return (
    <>
      <PageHeader title="Minha conta" description={`Acesso à área do cliente de ${actor.orgName}`} />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Dados pessoais</CardTitle>
              <CardDescription>Como você aparece para a agência nos comentários e aprovações.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ProfileForm name={actor.name} email={actor.email} />
          </CardContent>
        </Card>
        <Card id="seguranca" className="scroll-mt-20">
          <CardHeader>
            <div>
              <CardTitle>Senha</CardTitle>
              <CardDescription>Ao alterar a senha, as outras sessões abertas são encerradas.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Sessões ativas</CardTitle>
              <CardDescription>Dispositivos conectados à sua conta. Encerre os que você não reconhece.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <SessionsList />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
