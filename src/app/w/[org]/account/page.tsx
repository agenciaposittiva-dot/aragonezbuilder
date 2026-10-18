import type { Metadata } from "next";
import { ChatAlertsForm } from "@/components/account/chat-alerts-form";
import { PasswordForm } from "@/components/account/password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { NotificationPreferencesForm } from "@/components/account/notification-preferences-form";
import { SessionsList } from "@/components/account/sessions-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { emailConfigured } from "@/server/mail";
import {
  categoriesFor,
  getChatAlertPrefs,
  getNotificationPreferences,
} from "@/server/services/notification-preferences";
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function AccountPage({ params }: PageProps<"/w/[org]/account">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal" });
  const chat = can(actor, "chat.use");
  const [prefs, chatAlerts] = await Promise.all([
    inOrg(actor, getNotificationPreferences),
    chat ? inOrg(actor, getChatAlertPrefs) : null,
  ]);
  return (
    <>
      <PageHeader title="Meu perfil" description={`${actor.roleName} em ${actor.orgName}`} />
      <div className="grid max-w-3xl gap-6">
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
        {chatAlerts ? (
          <Card id="avisos-chat" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Avisos de mensagens</CardTitle>
                <CardDescription>
                  Janela flutuante, som e notificações do sistema quando chega uma mensagem no Chat da Equipe. Valem em
                  todos os seus aparelhos.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ChatAlertsForm initial={chatAlerts} chatHref={`/w/${actor.orgSlug}/chat`} />
            </CardContent>
          </Card>
        ) : null}
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
