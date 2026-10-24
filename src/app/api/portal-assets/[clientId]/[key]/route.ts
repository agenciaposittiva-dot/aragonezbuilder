import { parsePortalAssetKey } from "@/lib/portal-settings";
import { assertClientAccess, can, inOrg } from "@/server/authz";
import { routeActorForOrgId } from "@/server/auth/route-actor";
import { resolvePortalAsset } from "@/server/services/client-portal";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";

const notFound = () => new Response("Não encontrado.", { status: 404 });

/**
 * Imagens de marca do portal. Logotipos, ícone e fundo do login publicados são
 * públicos (aparecem antes do login, por escolha da agência). O banner e
 * qualquer item de rascunho exigem sessão com acesso ao cliente; o rascunho,
 * apenas a equipe da agência. Só imagens PNG/JPEG/WebP do próprio cliente.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/portal-assets/[clientId]/[key]">) {
  const { clientId, key: rawKey } = await ctx.params;
  const key = parsePortalAssetKey(rawKey);
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !key) return notFound();
  const draft = new URL(req.url).searchParams.get("draft") === "1";
  const asset = await resolvePortalAsset(clientId, key, { draft });
  if (!asset) return notFound();

  if (!asset.public) {
    const actor = await routeActorForOrgId(req, asset.orgId);
    if (!actor) return notFound();
    if (draft && (actor.kind !== "internal" || !can(actor, "clients.read"))) return notFound();
    if (actor.kind === "client" && !actor.clientIds.includes(clientId)) return notFound();
    try {
      await inOrg(actor, (s) => assertClientAccess(s, clientId));
    } catch {
      return notFound();
    }
  }

  try {
    const { body, size } = await getStorage().stream(asset.storageKey);
    return new Response(body, {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(size),
        "Cache-Control": asset.public ? "public, max-age=300" : "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return notFound();
  }
}
