import { chatHandler } from "@/server/chat-http";
import { recentAlerts, unreadTotal } from "@/server/services/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contador da navegação e avisos recentes (para notificações do navegador). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const since = new Date(Number(q.get("since")) || Date.now() - 60_000);
  return chatHandler(req, q.get("org"), async (s) => ({
    unread: await unreadTotal(s),
    alerts: (await recentAlerts(s, since)).map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  }));
}
