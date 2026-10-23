import type { Metadata } from "next";
import { z } from "zod";
import { ChatApp } from "@/components/chat/chat-app";
import { ChatEmbedBridge } from "@/components/chat/chat-embed-bridge";
import { WorkspaceProvider } from "@/components/shell/workspace-context";
import { requireActor } from "@/server/auth/session";
import { workspaceInfo } from "@/server/authz/workspace-info";
import { chatAppProps } from "@/server/services/chat-page";

export const metadata: Metadata = { title: "Chat da Equipe" };

/**
 * Chat da Equipe dentro da janela flutuante (iframe do mesmo site, montada pelo
 * layout da área da equipe). Mesmas regras e mesmos dados da página inteira;
 * sem menu, cabeçalho nem avisos próprios (os avisos ficam com a página de fora).
 */
export default async function ChatDockPage({ params, searchParams }: PageProps<"/chat-dock/[org]/[[...id]]">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "chat.use" });
  const activeId = z.uuid().safeParse(id?.[0]).data ?? null;
  const seq = Number(typeof sp.m === "string" ? sp.m : NaN);
  return (
    <WorkspaceProvider value={workspaceInfo(actor)}>
      <ChatEmbedBridge />
      <ChatApp {...await chatAppProps(actor, activeId, seq)} embed />
    </WorkspaceProvider>
  );
}
