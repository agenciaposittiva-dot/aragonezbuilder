import { createHash } from "node:crypto";
import { chatHandler } from "@/server/chat-http";
import { NotFoundError } from "@/server/errors";
import { listConversations, presenceOf, syncConversation, touchPresence } from "@/server/services/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sincronização do chat (chamada periodicamente pelo navegador; o intervalo
 * encurta com a aba visível). Devolve a lista de conversas só quando ela
 * mudou (`lv`), as mudanças da conversa aberta depois de `rev` e a presença.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return chatHandler(req, q.get("org"), async (s) => {
    await touchPresence(s);
    const list = await listConversations(s);
    const lv = createHash("sha1").update(JSON.stringify(list)).digest("hex").slice(0, 16);
    const unread = list
      .filter((c) => !c.muted && c.notify !== "none" && !c.hidden && !c.archived)
      .reduce((n, c) => n + c.unread, 0);
    const conversationId = q.get("c");
    let active: Awaited<ReturnType<typeof syncConversation>> | null = null;
    let gone = false;
    if (conversationId) {
      try {
        active = await syncConversation(s, conversationId, Math.max(0, Number(q.get("rev")) || 0));
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        gone = true;
      }
    }
    const presence = active
      ? await presenceOf(
          s,
          active.conversation.participants.map((p) => p.userId),
        )
      : [];
    return { lv, conversations: lv === q.get("lv") ? null : list, unread, active, gone, presence };
  });
}
