import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inOrg } from "@/server/authz";
import { routeActorForOrgId } from "@/server/auth/route-actor";
import { withSystem } from "@/server/db";
import { chatConversations } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { readConversationPhoto } from "@/server/services/chat-photo";

export const runtime = "nodejs";

const notFound = () => new NextResponse(null, { status: 404 });

/**
 * Foto de grupo/canal: confere a cada pedido se a pessoa pode ler a conversa.
 * A URL muda a cada foto (hash), então o cache privado pode ser longo.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/chat/photo/[id]/[hash]">) {
  const { id, hash } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !/^[0-9a-f]{32}$/.test(hash)) return notFound();
  const [conv] = await withSystem((tx) =>
    tx
      .select({ orgId: chatConversations.organizationId })
      .from(chatConversations)
      .where(eq(chatConversations.id, id))
      .limit(1),
  );
  if (!conv) return notFound();
  const actor = await routeActorForOrgId(req, conv.orgId);
  if (!actor) return notFound();
  try {
    const body = await inOrg(actor, (s) => readConversationPhoto(s, id, hash));
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return notFound();
    console.error("[chat] foto indisponível", id, err);
    return notFound();
  }
}
