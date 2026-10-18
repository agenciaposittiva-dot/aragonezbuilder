import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { conversationImage } from "@/lib/chat-photo";
import { chatConversations, chatParticipants, notifications, user } from "@/server/db/schema";
import type { Scope } from "@/server/authz";

export async function listNotifications(s: Scope, limit = 20) {
  const rows = await s.db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      // Avisos do chat mostram a imagem atual da conversa (foto do grupo ou de quem escreveu na direta).
      chatId: chatConversations.id,
      chatKind: chatConversations.kind,
      chatName: chatConversations.name,
      chatImageHash: chatConversations.imageHash,
      chatOther: sql<{ name: string; image: string | null } | null>`(
        select json_build_object('name', u.name, 'image', u.image) from ${chatParticipants} p
        join ${user} u on u.id = p.user_id
        where p.conversation_id = ${chatConversations.id} and p.user_id <> ${s.actor.userId}
          and ${chatConversations.kind} = 'direct'
        limit 1)`,
    })
    .from(notifications)
    .leftJoin(
      chatConversations,
      and(eq(notifications.entityType, "chat_conversation"), eq(chatConversations.id, notifications.entityId)),
    )
    .where(eq(notifications.userId, s.actor.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map(({ chatId, chatKind, chatName, chatImageHash, chatOther, ...n }) => ({
    ...n,
    chat: chatId
      ? {
          kind: chatKind!,
          name: chatOther?.name ?? chatName ?? n.title,
          image: conversationImage({
            id: chatId,
            kind: chatKind!,
            imageHash: chatImageHash,
            otherImage: chatOther?.image,
          }),
        }
      : null,
  }));
}

export async function unreadCount(s: Scope) {
  const [row] = await s.db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, s.actor.userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export const markReadInput = z.object({
  id: z.uuid().optional(),
  all: z.boolean().optional(),
});

export async function markRead(s: Scope, input: z.infer<typeof markReadInput>) {
  const mine = and(eq(notifications.userId, s.actor.userId), isNull(notifications.readAt));
  if (input.all) {
    await s.db.update(notifications).set({ readAt: new Date() }).where(mine);
  } else if (input.id) {
    await s.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(mine, eq(notifications.id, input.id)));
  }
}
