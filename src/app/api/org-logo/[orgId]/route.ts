import { auth } from "@/server/auth";
import { readOrgLogo } from "@/server/services/org-logo";

export const runtime = "nodejs";

const notFound = () => new Response("Não encontrado.", { status: 404 });

/**
 * Logo da agência para quem tem vínculo ativo com ela (equipe ou cliente).
 * Para qualquer outra pessoa a resposta é 404, sem revelar se a logo existe.
 * A URL leva o hash da imagem (?v=), então a cópia em cache nunca fica velha.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/org-logo/[orgId]">) {
  const { orgId } = await ctx.params;
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return notFound();
  const logo = await readOrgLogo(orgId, session.user.id);
  if (!logo) return notFound();
  const v = new URL(req.url).searchParams.get("v");
  const current = !!v && logo.hash.startsWith(v);
  return new Response(new Uint8Array(logo.body), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(logo.body.length),
      "Cache-Control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
      ETag: `"${logo.hash.slice(0, 32)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
