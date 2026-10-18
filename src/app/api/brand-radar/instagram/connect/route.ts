import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { inOrg } from "@/server/authz";
import { resolveActor } from "@/server/authz/actor";
import { auth } from "@/server/auth";
import { AppError } from "@/server/errors";
import { instagramConnectUrl } from "@/server/services/instagram";

export const dynamic = "force-dynamic";

/** Leva a pessoa ao Instagram para autorizar a conta (fluxo oficial; nunca pedimos senha). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgSlug = url.searchParams.get("org");
  const profileId = url.searchParams.get("profile");
  if (!orgSlug || !profileId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.redirect(new URL("/login", url));
  const actor = await resolveActor(session.user.id, orgSlug);
  if (!actor) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const back = new URL(`/w/${encodeURIComponent(orgSlug)}/brand-radar/${encodeURIComponent(profileId)}`, url);
  try {
    const target = await inOrg(actor, (s) => instagramConnectUrl(s, profileId, orgSlug));
    return NextResponse.redirect(target);
  } catch (err) {
    back.searchParams.set("ig", "error");
    back.searchParams.set("msg", err instanceof AppError ? err.message : "Não foi possível iniciar a conexão.");
    return NextResponse.redirect(back);
  }
}
