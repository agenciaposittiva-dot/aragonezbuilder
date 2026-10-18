import { chatHandler, readJson, str } from "@/server/chat-http";
import { markRead } from "@/server/services/chat";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson(req);
  return chatHandler(req, str(body.org), (s) => markRead(s, str(body.conversationId), Number(body.seq) || 0), {
    mutating: true,
  });
}
