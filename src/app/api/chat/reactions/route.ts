import { chatHandler, readJson, str } from "@/server/chat-http";
import { toggleReaction } from "@/server/services/chat";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson(req);
  return chatHandler(
    req,
    str(body.org),
    (s) => toggleReaction(s, { messageId: str(body.messageId), emoji: str(body.emoji) as never }),
    { mutating: true },
  );
}
