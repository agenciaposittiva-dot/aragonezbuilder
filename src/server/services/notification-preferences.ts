import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  type NotificationCategory,
  type NotificationPrefs,
} from "@/lib/notification-prefs";
import type { Scope } from "@/server/authz";
import type { Tx } from "@/server/db";
import { notificationPreferences } from "@/server/db/schema";

const channelMap = z
  .record(z.string(), z.boolean())
  .transform((m) =>
    Object.fromEntries(Object.entries(m).filter(([k]) => k in NOTIFICATION_CATEGORIES)),
  ) as unknown as z.ZodType<Partial<Record<NotificationCategory, boolean>>>;

export const notificationPrefsInput = z.object({ inApp: channelMap, email: channelMap });

/** Preferências da pessoa nesta organização (sem registro = tudo ligado). */
export async function getNotificationPreferences(s: Scope): Promise<NotificationPrefs> {
  const [row] = await s.db
    .select({ inApp: notificationPreferences.inApp, email: notificationPreferences.email })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, s.actor.userId));
  return { inApp: row?.inApp ?? {}, email: row?.email ?? {} };
}

/** Categorias disponíveis para o ator (convidados não veem as só da equipe). */
export function categoriesFor(kind: "internal" | "client") {
  return NOTIFICATION_CATEGORY_KEYS.filter((k) => kind === "internal" || !NOTIFICATION_CATEGORIES[k].internalOnly);
}

export async function updateNotificationPreferences(s: Scope, raw: z.input<typeof notificationPrefsInput>) {
  const data = notificationPrefsInput.parse(raw);
  await s.db
    .insert(notificationPreferences)
    .values({ organizationId: s.actor.orgId, userId: s.actor.userId, inApp: data.inApp, email: data.email })
    .onConflictDoUpdate({
      target: [notificationPreferences.organizationId, notificationPreferences.userId],
      set: { inApp: data.inApp, email: data.email },
    });
  return data;
}

/** Preferências de vários destinatários de uma vez (uso do despachante, já na organização). */
export async function preferencesFor(tx: Tx, orgId: string, userIds: string[]) {
  const out = new Map<string, NotificationPrefs>();
  if (!userIds.length) return out;
  const rows = await tx
    .select({
      userId: notificationPreferences.userId,
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.organizationId, orgId), inArray(notificationPreferences.userId, userIds)));
  for (const r of rows) out.set(r.userId, { inApp: r.inApp ?? {}, email: r.email ?? {} });
  return out;
}
