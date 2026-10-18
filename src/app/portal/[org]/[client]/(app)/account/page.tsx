import type { Metadata } from "next";
import { PasswordForm } from "@/components/account/password-form";
import { ProfilePhotoEditor } from "@/components/account/profile-photo-editor";
import { ProfileForm } from "@/components/account/profile-form";
import { NotificationPreferencesForm } from "@/components/account/notification-preferences-form";
import { SessionsList } from "@/components/account/sessions-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { env } from "@/server/env";
import { emailConfigured } from "@/server/mail";
import { categoriesFor, getNotificationPreferences } from "@/server/services/notification-preferences";
import { requirePortal } from "@/server/auth/portal";

export const metadata: Metadata = { title: "Minha conta" };

export default async function PortalAccountPage({ params }: PageProps<"/portal/[org]/[client]/account">) {
  const { org, client: clientSlug } = await params;
  const portal = await requirePortal(org, clientSlug);
  const { actor } = portal;
  const prefs = await inOrg(actor, getNotificationPreferences);
  return (
    <>
      <PageHeader title="Minha conta" description={`Acesso à área do cliente de ${actor.orgName}`} />
      <div className="grid max-w-3xl gap-6">
        <Card id="foto" className="scroll-mt-20">
          <CardHeader>
            <div>
              <CardTitle>Foto de perfil</CardTitle>
              <CardDescription>Aparece para a agência nos comentários, aprovações e solicitações.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ProfilePhotoEditor name={actor.name} src={actor.image} maxBytes={env.AVATAR_MAX_BYTES} />
          </CardContent>
        </Card>
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
        <Card id="notificacoes" className="scroll-mt-20">
          <CardHeader>
            <div>
              <CardTitle>Notificações</CardTitle>
              <CardDescription>Escolha o que você quer receber na plataforma e por e-mail.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <NotificationPreferencesForm
              initial={prefs}
              categories={categoriesFor(actor.kind)}
              emailConfigured={emailConfigured()}
            />
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
