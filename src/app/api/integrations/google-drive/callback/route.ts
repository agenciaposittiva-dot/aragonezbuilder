import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { resolveActor } from "@/server/authz/actor";
import { auth } from "@/server/auth";
import { AppError } from "@/server/errors";
import { completeGoogleDriveConnection, verifyDriveState } from "@/server/services/google-drive";

export const dynamic = "force-dynamic";

/**
 * Retorno do Google depois da autorização. O estado é assinado e preso à
 * pessoa que começou a conexão (CSRF). Este endereço precisa estar cadastrado
 * no Google Cloud Console como URI de redirecionamento (docs/GOOGLE-DRIVE.md).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.redirect(new URL("/login", url));

  const claims = verifyDriveState(url.searchParams.get("state") ?? "", session.user.id);
  if (!claims) {
    return NextResponse.json(
      { error: "Pedido de conexão inválido ou vencido. Volte a Armazenamento e integrações e tente de novo." },
      { status: 400 },
    );
  }
  const back = new URL(`/w/${encodeURIComponent(claims.org)}/account/integrations`, url);
  const fail = (message: string) => {
    back.searchParams.set("drive", "error");
    back.searchParams.set("msg", message);
    return NextResponse.redirect(back);
  };
  if (url.searchParams.get("error")) return fail("A autorização foi cancelada no Google.");
  const code = url.searchParams.get("code");
  if (!code) return fail("O Google não devolveu o código de autorização.");

  const actor = await resolveActor(session.user.id, claims.org);
  if (!actor) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  try {
    await completeGoogleDriveConnection(actor, code);
  } catch (err) {
    return fail(err instanceof AppError ? err.message : "Não foi possível concluir a conexão com o Google.");
  }
  back.searchParams.set("drive", "connected");
  return NextResponse.redirect(back);
}
