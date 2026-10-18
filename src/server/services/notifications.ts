import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notifications } from "@/server/db/schema";
import type { Scope } from "@/server/authz";

export async function listNotifications(s: Scope, limit = 20) {
  return s.db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, s.actor.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(s: Scope) {
  const [row] = await s.db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, s.actor.userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export const markReadInput = z.object({ id: z.uuid().optional(), all: z.boolean().optional() });

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
