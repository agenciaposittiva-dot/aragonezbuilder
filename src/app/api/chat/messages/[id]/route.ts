import { chatHandler, readJson, str } from "@/server/chat-http";
import { deleteMessage, editMessage } from "@/server/services/chat";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: RouteContext<"/api/chat/messages/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return chatHandler(req, str(body.org), (s) => editMessage(s, { messageId: id, body: str(body.body) }), {
    mutating: true,
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/chat/messages/[id]">) {
  const { id } = await ctx.params;
  const org = new URL(req.url).searchParams.get("org");
  return chatHandler(req, org, (s) => deleteMessage(s, id), { mutating: true });
}
