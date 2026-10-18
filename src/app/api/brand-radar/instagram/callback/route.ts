import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { resolveActor } from "@/server/authz/actor";
import { auth } from "@/server/auth";
import { AppError } from "@/server/errors";
import { completeInstagramConnection, verifyState } from "@/server/services/instagram";

export const dynamic = "force-dynamic";

/**
 * Retorno da Meta depois da autorização. O estado é assinado e preso à
 * pessoa que começou a conexão (protege contra falsificação de retorno).
 * Este endereço precisa estar cadastrado no app da Meta como URI de redirecionamento.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.redirect(new URL("/login", url));

  const claims = verifyState(url.searchParams.get("state") ?? "", session.user.id);
  if (!claims) {
    return NextResponse.json(
      { error: "Pedido de conexão inválido ou vencido. Volte ao Radar de Marca e tente de novo." },
      { status: 400 },
    );
  }
  const back = new URL(`/w/${encodeURIComponent(claims.org)}/brand-radar/${encodeURIComponent(claims.profileId)}`, url);
  const fail = (message: string) => {
    back.searchParams.set("ig", "error");
    back.searchParams.set("msg", message);
    return NextResponse.redirect(back);
  };

  // A pessoa recusou ou cancelou no Instagram.
  if (url.searchParams.get("error")) return fail("A autorização foi cancelada no Instagram.");
  const code = url.searchParams.get("code")?.replace(/#_$/, "");
  if (!code) return fail("O Instagram não devolveu o código de autorização.");

  const actor = await resolveActor(session.user.id, claims.org);
  if (!actor) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  try {
    await completeInstagramConnection(actor, { profileId: claims.profileId, code });
  } catch (err) {
    return fail(err instanceof AppError ? err.message : "Não foi possível concluir a conexão com o Instagram.");
  }
  back.searchParams.set("ig", "connected");
  return NextResponse.redirect(back);
}
