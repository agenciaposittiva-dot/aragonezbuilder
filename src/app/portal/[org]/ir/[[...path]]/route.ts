import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { inOrg } from "@/server/authz";
import { routeActor } from "@/server/auth/route-actor";
import { clients, files, projects, requests } from "@/server/db/schema";

export const runtime = "nodejs";

const ENTITY: Record<string, "request" | "file" | "project"> = {
  requests: "request",
  files: "file",
  projects: "project",
};

/**
 * Links genéricos da área do cliente (notificações, busca, links antigos):
 * descobre o portal certo e redireciona para /portal/<agência>/<cliente>/<caminho>.
 * O cliente vem do próprio registro do link (quando há um id), do parâmetro
 * `c`, do único cliente do convidado ou do último portal aberto; o acesso é
 * sempre conferido contra os clientes do convidado.
 */
export async function GET(req: Request, ctx: RouteContext<"/portal/[org]/ir/[[...path]]">) {
  const { org, path = [] } = await ctx.params;
  const url = new URL(req.url);
  const actor = await routeActor(req, org);
  if (!actor) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, url));
  }
  const segments = path.filter((p) => /^[a-z0-9_-]+$/i.test(p));
  if (actor.kind !== "client") {
    return NextResponse.redirect(new URL(`/w/${actor.orgSlug}/${segments.join("/")}`, url));
  }
  const allowed = [...actor.clientIds];
  let clientId: string | null = null;

  const entity = ENTITY[segments[0] ?? ""];
  const entityId = segments[1];
  if (entity && entityId && /^[0-9a-f-]{36}$/i.test(entityId) && allowed.length) {
    const table = entity === "request" ? requests : entity === "file" ? files : projects;
    const [row] = await inOrg(actor, (s) =>
      s.db
        .select({ clientId: table.clientId })
        .from(table)
        .where(and(eq(table.id, entityId), inArray(table.clientId, allowed))),
    );
    clientId = row?.clientId ?? null;
  }
  const c = url.searchParams.get("c");
  if (!clientId && c && allowed.includes(c)) clientId = c;
  if (!clientId && allowed.length === 1) clientId = allowed[0]!;

  let slug: string | null = null;
  if (clientId) {
    const [row] = await inOrg(actor, (s) =>
      s.db.select({ slug: clients.slug }).from(clients).where(eq(clients.id, clientId)),
    );
    slug = row?.slug ?? null;
  } else {
    const remembered = req.headers
      .get("cookie")
      ?.split(";")
      .map((p) => p.trim().split("="))
      .find(([k]) => k === `pc_${encodeURIComponent(actor.orgSlug)}`)?.[1];
    if (remembered && allowed.length) {
      const [row] = await inOrg(actor, (s) =>
        s.db
          .select({ slug: clients.slug })
          .from(clients)
          .where(and(eq(clients.slug, decodeURIComponent(remembered)), inArray(clients.id, allowed))),
      );
      slug = row?.slug ?? null;
    }
  }
  const rest = segments.length ? `/${segments.join("/")}` : "";
  const query = new URLSearchParams(url.searchParams);
  query.delete("c");
  const qs = query.toString() ? `?${query.toString()}` : "";
  if (!slug) {
    return NextResponse.redirect(new URL(`/portal/${actor.orgSlug}?next=${encodeURIComponent(rest)}`, url));
  }
  return NextResponse.redirect(new URL(`/portal/${actor.orgSlug}/${slug}${rest}${qs}`, url));
}
