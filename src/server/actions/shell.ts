"use server";

import { z } from "zod";
import { orgAction } from "./safe-action";
import { guideSteps } from "@/server/services/guide";
import { globalSearch } from "@/server/services/search";
import { listNotifications, markRead, markReadInput, unreadCount } from "@/server/services/notifications";

export const searchAction = orgAction(z.object({ q: z.string().max(100) }), (s, { q }) => globalSearch(s, q), {
  refresh: false,
});

export const notificationsAction = orgAction(
  z.object({}),
  async (s) => ({ items: await listNotifications(s), unread: await unreadCount(s) }),
  { refresh: false },
);

export const markNotificationsReadAction = orgAction(markReadInput, markRead, { refresh: false });

export const guideAction = orgAction(z.object({}), (s) => guideSteps(s), { refresh: false });
