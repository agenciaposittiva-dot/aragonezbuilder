import { NextResponse } from "next/server";
import { inOrg } from "@/server/authz";
import { jsonError, routeActor } from "@/server/auth/route-actor";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { processEventsInBackground } from "@/server/events/inline";
import { importClientPackage } from "@/server/services/client-package";

export const runtime = "nodejs";

function str(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Importa um pacote de cliente (.zip com manifest.json). Tudo é criado numa
 * única transação: se qualquer etapa falhar, nenhum cliente fica pela metade.
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > env.UPLOAD_MAX_BYTES * 1.05 + 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Pacote grande demais." }, { status: 413 });
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
  if (!actor) return NextResponse.json({ ok: false, error: "Acesso negado." }, { status: 401 });

  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
    return jsonError(new ValidationError("Envie o arquivo .zip do pacote."));
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await inOrg(actor, (s) => importClientPackage(s, buffer, { categoryId: str(form, "categoryId") }));
    processEventsInBackground();
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
