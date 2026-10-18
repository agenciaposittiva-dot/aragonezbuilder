import { chatHandler, readJson, str } from "@/server/chat-http";
import { setTyping } from "@/server/services/chat";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson(req);
  return chatHandler(req, str(body.org), (s) => setTyping(s, str(body.conversationId), body.typing === true), {
    mutating: true,
  });
}
