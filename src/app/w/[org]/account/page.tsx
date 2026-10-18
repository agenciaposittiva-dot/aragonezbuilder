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
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function AccountPage({ params }: PageProps<"/w/[org]/account">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal" });
  const prefs = await inOrg(actor, getNotificationPreferences);
  return (
    <>
      <PageHeader title="Meu perfil" description={`${actor.roleName} em ${actor.orgName}`} />
      <div className="grid max-w-3xl gap-6">
        <Card id="foto" className="scroll-mt-20">
          <CardHeader>
            <div>
              <CardTitle>Foto de perfil</CardTitle>
              <CardDescription>
                Aparece no menu, no chat, nos comentários e nas tarefas. É só sua — a logo da agência fica em
                Configurações.
              </CardDescription>
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
              <CardDescription>Como você aparece para a equipe e para os clientes.</CardDescription>
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
