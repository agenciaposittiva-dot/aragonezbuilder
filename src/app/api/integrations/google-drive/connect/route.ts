import { NextResponse } from "next/server";
import { z } from "zod";
import { inOrg } from "@/server/authz";
import { actorForRequest } from "@/server/http";
import { AppError } from "@/server/errors";
import { googleDriveConnectUrl } from "@/server/services/google-drive";

export const dynamic = "force-dynamic";

/** Começa a autorização no Google para a pessoa logada (estado assinado e preso a ela). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const org = z.string().min(1).max(64).safeParse(url.searchParams.get("org"));
  if (!org.success) return NextResponse.json({ error: "Organização inválida." }, { status: 400 });
  const resolved = await actorForRequest(org.data);
  if ("response" in resolved) return resolved.response;
  try {
    const target = await inOrg(resolved.actor, async (s) => googleDriveConnectUrl(s));
    return NextResponse.redirect(target);
  } catch (err) {
    const back = new URL(`/w/${encodeURIComponent(org.data)}/account/integrations`, url);
    back.searchParams.set("drive", "error");
    back.searchParams.set("msg", err instanceof AppError ? err.message : "Não foi possível iniciar a conexão.");
    return NextResponse.redirect(back);
  }
}
