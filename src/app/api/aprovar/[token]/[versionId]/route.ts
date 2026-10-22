import { NextResponse } from "next/server";
import { mustDownload } from "@/server/services/file-type";
import { approvalLinkVersion } from "@/server/services/approval-links";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";

/**
 * Arquivo exibido no link de aprovação (sem sessão): só a versão atual de um
 * arquivo do link, enquanto ele está ativo. Redireciona para um link assinado
 * curto. ?thumb=1 entrega a miniatura.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/aprovar/[token]/[versionId]">) {
  const { token, versionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return new NextResponse(null, { status: 404 });
  const v = await approvalLinkVersion(token, versionId).catch(() => null);
  if (!v) return new NextResponse(null, { status: 404 });
  const url = new URL(req.url);
  const storage = getStorage();
  const thumb = url.searchParams.get("thumb") === "1";
  if (thumb && !v.thumbnailKey) return new NextResponse(null, { status: 404 });
  const target = thumb
    ? await storage.signedUrl(v.thumbnailKey!, {
        name: "thumb.webp",
        contentType: "image/webp",
        disposition: "inline",
        expiresIn: 900,
      })
    : await storage.signedUrl(v.storageKey, {
        name: v.originalName,
        contentType: v.mimeType,
        disposition: mustDownload(v.mimeType) ? "attachment" : "inline",
        expiresIn: 900,
      });
  const res = NextResponse.redirect(new URL(target, url.origin), 302);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
