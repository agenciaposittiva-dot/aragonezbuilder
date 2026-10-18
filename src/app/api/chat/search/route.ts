import { chatHandler } from "@/server/chat-http";
import { searchMessages } from "@/server/services/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Busca no histórico (só conversas que a pessoa pode ler). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return chatHandler(req, q.get("org"), (s) =>
    searchMessages(s, q.get("q") ?? "", { conversationId: q.get("c") || undefined }),
  );
}
