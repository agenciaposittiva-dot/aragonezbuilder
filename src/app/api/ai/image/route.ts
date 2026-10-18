import { NextResponse } from "next/server";
import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { imageInput, prepareImage, type PreparedImage } from "@/server/services/ai-images";
import { ModelSelectionError } from "@/server/services/ai-models";
import { runImage } from "@/server/services/ai-run";

export const runtime = "nodejs";
export const maxDuration = 120;

const body = imageInput.extend({ orgSlug: z.string().min(1).max(64) });

/**
 * Gera imagens com um modelo de imagem habilitado (hoje: Images API da
 * OpenAI). A imagem é salva na Central de Arquivos quando a pessoa pode
 * enviar arquivos; o uso é registrado também em caso de falha.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const prompt = parsed.error.issues.find((i) => i.path[0] === "prompt");
    return jsonError(prompt?.message ?? "Pedido inválido.", 400);
  }
  const resolved = await actorForRequest(parsed.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let prepared: PreparedImage;
  try {
    prepared = await inOrg(actor, (s) => prepareImage(s, parsed.data));
  } catch (err) {
    if (err instanceof ModelSelectionError) {
      return jsonError(err.message, 422, {
        code: "model_selection",
        reason: err.reason,
        alternatives: err.alternatives,
      });
    }
    if (err instanceof CostConfirmationError) {
      return jsonError(err.message, 409, { code: "cost_confirmation", estimateMicros: err.estimateMicros });
    }
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err), { fieldErrors: err.fieldErrors });
    console.error("[ai] falha ao preparar imagem", err);
    return jsonError("Não foi possível preparar o pedido.", 500);
  }

  const r = await runImage(actor, prepared, { signal: req.signal });
  if (!r.ok) {
    const status = r.appError ? errorStatus(r.appError) : r.kind === "rate_limit" ? 429 : 502;
    return jsonError(r.message, status, { code: "provider_error", retryable: r.retryable });
  }
  return NextResponse.json({
    ok: true,
    provider: prepared.providerId,
    providerLabel: prepared.providerLabel,
    model: r.result.model,
    reason: prepared.reason,
    warnings: prepared.warnings,
    generationId: r.saved.generationId,
    files: r.saved.files,
    // Sem permissão de envio a imagem não é salva: devolvemos os bytes para a pessoa baixar.
    images: r.saved.files.length ? [] : r.result.images.map((b) => `data:image/png;base64,${b.toString("base64")}`),
    usage: {
      inputTokens: r.result.inputTokens,
      outputTokens: r.result.outputTokens,
      costMicros: r.result.costMicros,
      durationMs: r.durationMs,
    },
  });
}
