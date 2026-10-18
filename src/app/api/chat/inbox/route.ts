import { chatHandler } from "@/server/chat-http";
import { chatInbox, unreadTotal } from "@/server/services/chat";
import { getChatAlertPrefs } from "@/server/services/notification-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60_000;

/**
 * Avisos de mensagens em toda a plataforma: o que chegou para a pessoa desde o
 * último cursor, o contador de não lidas, o estado das janelas abertas e as
 * preferências de aviso (para valerem logo em todos os aparelhos).
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const now = Date.now();
  const num = (v: string | null) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(n, now) : null;
  };
  const since = Math.max(num(q.get("since")) ?? now, now - DAY);
  const after = num(q.get("after"));
  const watch = (q.get("watch") ?? "").split(",").filter(Boolean);
  return chatHandler(req, q.get("org"), async (s) => ({
    ...(await chatInbox(s, { since, after, watch })),
    unread: await unreadTotal(s),
    prefs: await getChatAlertPrefs(s),
  }));
}
