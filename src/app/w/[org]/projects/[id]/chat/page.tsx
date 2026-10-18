import Link from "next/link";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { ShareToChatButton } from "@/components/chat/share-to-chat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { excerpt } from "@/lib/chat-format";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { chatMembers, listConversations, projectMentions } from "@/server/services/chat";

export default async function ProjectChatPage({ params }: PageProps<"/w/[org]/projects/[id]/chat">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "chat.use" });
  const data = await inOrg(actor, async (s) => ({
    mentions: await projectMentions(s, id),
    conversations: (await listConversations(s)).filter((c) => !c.archived && c.projectId !== id),
    members: await chatMembers(s),
  }));
  const names = new Map(data.members.map((m) => [m.userId, m.name]));
  const nameOf = (uid: string) => names.get(uid);
  const base = `/w/${actor.orgSlug}/chat`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Citado em outras conversas</CardTitle>
        </CardHeader>
        <CardContent>
          {data.mentions.length ? (
            <ul className="divide-y divide-border">
              {data.mentions.map((m) => (
                <li key={m.id}>
                  <Link href={`${base}/${m.conversationId}?m=${m.seq}`} className="block py-2.5 hover:bg-surface-2/60">
                    <span className="block text-xs text-fg-muted">
                      {m.conversationKind === "channel" ? "#" : ""}
                      {m.conversationName ?? "Conversa"} · {m.authorName ?? "Alguém"} ·{" "}
                      {new Date(m.createdAt).toLocaleString("pt-BR")}
                    </span>
                    <span className="block text-sm break-words">{excerpt(m.body, nameOf, 200)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">
              Nenhuma mensagem com link para o projeto ou para as tarefas dele (só aparecem conversas que você pode
              ler).
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Conversa do projeto</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-fg-muted">
            Um canal só deste projeto, com o responsável e a equipe dele. Quem tem acesso ao projeto pode entrar.
          </p>
          <OpenChatButton kind="project" id={id} label="Abrir conversa do projeto" variant="primary" />
          <ShareToChatButton
            type="projects"
            id={id}
            conversations={data.conversations.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
