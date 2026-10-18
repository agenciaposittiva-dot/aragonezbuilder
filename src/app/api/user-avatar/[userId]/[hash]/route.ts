import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { readUserAvatar } from "@/server/services/user-avatar";

export const runtime = "nodejs";

/**
 * Foto de perfil. Só para quem está logado e trabalha com a pessoa (ou é ela).
 * A URL muda a cada foto nova (hash), então o cache privado pode ser longo.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/user-avatar/[userId]/[hash]">) {
  const { userId, hash } = await ctx.params;
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 404 });
  const body = await readUserAvatar(userId, hash, session.user.id);
  if (!body) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
