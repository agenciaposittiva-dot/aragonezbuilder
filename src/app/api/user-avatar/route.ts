import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { jsonError } from "@/server/auth/route-actor";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { isSameOrigin } from "@/server/http";
import { orgLogoCropSchema } from "@/server/services/org-logo";
import { removeUserAvatar, saveUserAvatar } from "@/server/services/user-avatar";

export const runtime = "nodejs";

const denied = (status = 401) =>
  NextResponse.json({ ok: false, error: status === 403 ? "Origem não permitida." : "Entre novamente." }, { status });

/**
 * Envia ou substitui a foto de perfil de quem está logado (multipart: file,
 * crop). Não aceita id de usuário: a conta é sempre a da sessão. Responde só
 * depois de gravar o arquivo e atualizar o perfil.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return denied(403);
  const session = await getSession();
  if (!session) return denied();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > env.AVATAR_MAX_BYTES + 256 * 1024) {
    return NextResponse.json({ ok: false, error: "Imagem grande demais para a foto." }, { status: 413 });
  }
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError("Envio inválido.");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw new ValidationError("Nenhuma imagem enviada.");
    const rawCrop = form.get("crop");
    let crop = null;
    if (typeof rawCrop === "string" && rawCrop) {
      const parsed = orgLogoCropSchema.safeParse(JSON.parse(rawCrop));
      if (!parsed.success) throw new ValidationError("Enquadramento inválido.");
      crop = parsed.data;
    }
    const res = await saveUserAvatar(session.user.id, { buffer: Buffer.from(await file.arrayBuffer()), crop });
    return NextResponse.json({ ok: true, ...res }, { status: res.changed ? 201 : 200 });
  } catch (err) {
    if (err instanceof SyntaxError) return jsonError(new ValidationError("Enquadramento inválido."));
    return jsonError(err);
  }
}

/** Remove a foto de perfil de quem está logado. */
export async function DELETE(req: Request) {
  if (!isSameOrigin(req)) return denied(403);
  const session = await getSession();
  if (!session) return denied();
  try {
    return NextResponse.json({ ok: true, ...(await removeUserAvatar(session.user.id)) });
  } catch (err) {
    return jsonError(err);
  }
}
