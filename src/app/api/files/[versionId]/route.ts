import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { inOrg } from "@/server/authz";
import { jsonError, routeActorForOrgId } from "@/server/auth/route-actor";
import { withSystem } from "@/server/db";
import { fileVersions } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { mustDownload } from "@/server/services/file-type";
import { getVersionForDownload } from "@/server/services/files";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";

/**
 * Acesso a uma versão de arquivo: verifica sessão e escopo do usuário e
 * redireciona para um link assinado de curta duração.
 * ?download=1 força download; ?thumb=1 entrega a miniatura.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[versionId]">) {
  const { versionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return jsonError(new NotFoundError());
  const url = new URL(req.url);
  try {
    const [row] = await withSystem((tx) =>
      tx
        .select({ orgId: fileVersions.organizationId })
        .from(fileVersions)
        .where(eq(fileVersions.id, versionId))
        .limit(1),
    );
    if (!row) throw new NotFoundError("Arquivo não encontrado.");
    const actor = await routeActorForOrgId(req, row.orgId);
    if (!actor) throw new NotFoundError("Arquivo não encontrado.");
    const v = await inOrg(actor, (s) => getVersionForDownload(s, versionId));
    const storage = getStorage();

    let target: string;
    if (url.searchParams.get("thumb") === "1") {
      if (!v.thumbnailKey) return new NextResponse(null, { status: 404 });
      target = await storage.signedUrl(v.thumbnailKey, {
        name: "thumb.webp",
        contentType: "image/webp",
        disposition: "inline",
        expiresIn: 3600,
      });
    } else {
      const download = url.searchParams.get("download") === "1" || mustDownload(v.mimeType);
      target = await storage.signedUrl(v.storageKey, {
        name: v.originalName,
        contentType: v.mimeType,
        disposition: download ? "attachment" : "inline",
      });
    }
    const res = NextResponse.redirect(new URL(target, url.origin), 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
