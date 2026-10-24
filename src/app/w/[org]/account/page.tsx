import type { Metadata } from "next";
import { Cloud, Sparkles } from "lucide-react";
import Link from "next/link";
import { ChatAlertsForm } from "@/components/account/chat-alerts-form";
import { PasswordForm } from "@/components/account/password-form";
import { ProfilePhotoEditor } from "@/components/account/profile-photo-editor";
import { ProfileForm } from "@/components/account/profile-form";
import { NotificationPreferencesForm } from "@/components/account/notification-preferences-form";
import { SessionsList } from "@/components/account/sessions-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { env } from "@/server/env";
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
        {can(actor, "ai.use") ? (
          <Card id="ia" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4 text-accent-text" aria-hidden="true" /> Minhas inteligências artificiais
                </CardTitle>
                <CardDescription>
                  Conecte suas próprias chaves de IA (OpenAI, Anthropic, Gemini, Magnific), escolha o modelo padrão de
                  cada finalidade e acompanhe o seu consumo. As chaves ficam criptografadas no servidor e valem só para
                  você.
                </CardDescription>
              </div>
              <Button variant="secondary" asChild>
                <Link href={`/w/${actor.orgSlug}/account/ai`} data-testid="account-ai-link">
                  Gerenciar
                </Link>
              </Button>
            </CardHeader>
          </Card>
        ) : null}
        {can(actor, "files.write") ? (
          <Card id="integracoes" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Cloud className="size-4 text-accent-text" aria-hidden="true" /> Armazenamento e integrações
                </CardTitle>
                <CardDescription>
                  Conecte o seu Google Drive para salvar exportações do Estúdio e importar arquivos. A conexão é só sua;
                  os tokens ficam criptografados no servidor.
                </CardDescription>
              </div>
              <Button variant="secondary" asChild>
                <Link href={`/w/${actor.orgSlug}/account/integrations`} data-testid="account-integrations-link">
                  Gerenciar
                </Link>
              </Button>
            </CardHeader>
          </Card>
        ) : null}
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
