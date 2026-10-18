import { NextResponse } from "next/server";
import { routeActor } from "@/server/auth/route-actor";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { processEventsInBackground } from "@/server/events/inline";
import { errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { importImageAsTemplate } from "@/server/services/design-import";

export const runtime = "nodejs";
export const maxDuration = 120;

function str(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Importa um JPG/PNG como modelo editável (multipart: orgSlug, file, name,
 * clientId, asTemplate, reconstruct, selection, confirmCost). Responde só
 * depois de gravar o arquivo e o template.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > env.UPLOAD_MAX_BYTES * 1.05 + 1024 * 1024) return jsonError("Imagem grande demais.", 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Envio inválido.", 400);
  }
  const orgSlug = str(form, "orgSlug");
  if (!orgSlug) return jsonError("Organização não informada.", 400);
  const actor = await routeActor(req, orgSlug);
  if (!actor) return jsonError("Acesso negado.", 401);
  const file = form.get("file");
  if (!file || typeof file === "string") return jsonError("Nenhuma imagem enviada.", 422);
  let selection: unknown = undefined;
  try {
    selection = str(form, "selection") ? JSON.parse(str(form, "selection")!) : undefined;
  } catch {
    return jsonError("Seleção de modelo inválida.", 422);
  }
  try {
    const res = await importImageAsTemplate(
      actor,
      { buffer: Buffer.from(await file.arrayBuffer()), originalName: file.name },
      {
        name: str(form, "name") ?? undefined,
        clientId: str(form, "clientId"),
        asTemplate: str(form, "asTemplate") !== "false",
        reconstruct: str(form, "reconstruct") === "true",
        selection: selection as never,
        confirmCost: str(form, "confirmCost") === "true",
      },
    );
    processEventsInBackground();
    return NextResponse.json({ ok: true, ...res }, { status: 201 });
  } catch (err) {
    if (err instanceof ModelSelectionError)
      return jsonError(err.message, 422, {
        code: "model_selection",
        reason: err.reason,
        alternatives: err.alternatives,
      });
    if (err instanceof CostConfirmationError)
      return jsonError(err.message, 409, { code: "cost_confirmation", estimateMicros: err.estimateMicros });
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err), { code: err.code });
    console.error("[estúdio] falha ao importar template", err);
    return jsonError("Não foi possível importar a imagem.", 500);
  }
}
