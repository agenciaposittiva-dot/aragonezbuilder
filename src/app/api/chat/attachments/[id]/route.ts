import { NextResponse } from "next/server";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, jsonError } from "@/server/http";
import { chatAttachmentUrl } from "@/server/services/chat-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Abre um anexo: confirma, a cada pedido, que a pessoa pode ler a conversa e
 * redireciona para um link assinado de poucos minutos. O endereço sozinho não
 * dá acesso a nada (precisa da sessão de quem participa).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/chat/attachments/[id]">) {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const org = q.get("org");
  if (!org) return jsonError("Organização não informada.", 400);
  const resolved = await actorForRequest(org);
  if ("response" in resolved) return resolved.response;
  try {
    const url = await inOrg(resolved.actor, (s) => chatAttachmentUrl(s, id, { download: q.get("download") === "1" }));
    const res = NextResponse.redirect(new URL(url, req.url), 302);
    res.headers.set("cache-control", "private, no-store");
    return res;
  } catch (err) {
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err));
    console.error("[chat] falha ao abrir anexo", err);
    return jsonError("Não foi possível abrir o arquivo.", 500);
  }
}
