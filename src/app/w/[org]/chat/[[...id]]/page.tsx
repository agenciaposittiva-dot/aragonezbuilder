import type { Metadata } from "next";
import { z } from "zod";
import { ChatApp } from "@/components/chat/chat-app";
import { requireActor } from "@/server/auth/session";
import { chatAppProps } from "@/server/services/chat-page";

export const metadata: Metadata = { title: "Chat da Equipe" };

export default async function ChatPage({ params, searchParams }: PageProps<"/w/[org]/chat/[[...id]]">) {
  const { org, id } = await params;
  const sp = await searchParams;
  // Clientes (kind=client) não chegam aqui: o chat é só da equipe interna.
  const actor = await requireActor(org, { kind: "internal", permission: "chat.use" });
  const activeId = z.uuid().safeParse(id?.[0]).data ?? null;
  const seq = Number(typeof sp.m === "string" ? sp.m : NaN);
  return <ChatApp {...await chatAppProps(actor, activeId, seq)} />;
}
