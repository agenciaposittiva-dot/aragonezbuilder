import { chatHandler, readJson, str } from "@/server/chat-http";
import { olderMessages, sendMessage } from "@/server/services/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Envia uma mensagem (idempotente por clientId). */
export async function POST(req: Request) {
  const body = await readJson(req);
  return chatHandler(
    req,
    str(body.org),
    (s) =>
      sendMessage(s, {
        conversationId: str(body.conversationId),
        clientId: str(body.clientId),
        body: str(body.body),
        replyToId: str(body.replyToId) || null,
        attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String) : [],
      }),
    { mutating: true },
  );
}

/** Histórico anterior (carregamento progressivo). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return chatHandler(req, q.get("org"), (s) =>
    olderMessages(s, q.get("c") ?? "", Number(q.get("before")) || 0, Number(q.get("limit")) || undefined),
  );
}
