import { NextResponse } from "next/server";
import { jsonError, routeActor } from "@/server/auth/route-actor";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { orgLogoBackgroundSchema, orgLogoCropSchema, removeOrgLogo, saveOrgLogo } from "@/server/services/org-logo";

export const runtime = "nodejs";

function str(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const denied = () => NextResponse.json({ ok: false, error: "Acesso negado." }, { status: 401 });

/**
 * Envia ou substitui a logo da agência (multipart: orgSlug, file, crop, background).
 * A organização é a do vínculo do usuário com o slug informado; a permissão
 * `org.manage` é verificada no serviço. Responde só depois de gravar o arquivo
 * e a referência no banco.
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > env.LOGO_MAX_BYTES + 256 * 1024) {
    return NextResponse.json({ ok: false, error: "Imagem grande demais para a logo." }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Envio inválido." }, { status: 400 });
  }
  const orgSlug = str(form, "orgSlug");
  if (!orgSlug) return NextResponse.json({ ok: false, error: "Organização não informada." }, { status: 400 });
  const actor = await routeActor(req, orgSlug);
  if (!actor) return denied();

  try {
    const file = form.get("file");
    if (!file || typeof file === "string") throw new ValidationError("Nenhuma imagem enviada.");
    let crop = null;
    const rawCrop = str(form, "crop");
    if (rawCrop) {
      const parsed = orgLogoCropSchema.safeParse(JSON.parse(rawCrop));
      if (!parsed.success) throw new ValidationError("Enquadramento inválido.");
      crop = parsed.data;
    }
    const background = orgLogoBackgroundSchema.parse(str(form, "background") ?? undefined);
    const buffer = Buffer.from(await file.arrayBuffer());
    const res = await saveOrgLogo(actor, { buffer, crop, background });
    return NextResponse.json({ ok: true, ...res }, { status: res.changed ? 201 : 200 });
  } catch (err) {
    if (err instanceof SyntaxError) return jsonError(new ValidationError("Enquadramento inválido."));
    return jsonError(err);
  }
}

/** Remove a logo da agência (?org=slug). */
export async function DELETE(req: Request) {
  const orgSlug = new URL(req.url).searchParams.get("org");
  if (!orgSlug) return NextResponse.json({ ok: false, error: "Organização não informada." }, { status: 400 });
  const actor = await routeActor(req, orgSlug);
  if (!actor) return denied();
  try {
    return NextResponse.json({ ok: true, ...(await removeOrgLogo(actor)) });
  } catch (err) {
    return jsonError(err);
  }
}
