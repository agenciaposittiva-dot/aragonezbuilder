import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { processEventsInBackground } from "@/server/events/inline";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { carouselGenerateInput, prepareCarousel, runCarouselGeneration } from "@/server/services/carousel-generator";

export const runtime = "nodejs";
// Planejamento + imagens + montagem podem passar de um minuto.
export const maxDuration = 300;

const body = carouselGenerateInput.extend({ orgSlug: z.string().min(1).max(64) });

/**
 * Gera um carrossel completo e transmite o progresso REAL em NDJSON:
 * {t:"meta"} {t:"step", step, status} … {t:"done", designId} | {t:"error"}.
 * Permissões, modelo e custo são verificados antes da transmissão (erro JSON
 * comum: seleção de modelo 422, confirmação de custo 409).
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[i.path.join(".") || "_"] ??= []).push(i.message);
    return jsonError("Revise os campos destacados.", 422, { fieldErrors });
  }
  const resolved = await actorForRequest(parsed.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;
  const { orgSlug: _o, ...input } = parsed.data;
  void _o;

  let prepared: Awaited<ReturnType<typeof prepareCarousel>>;
  try {
    prepared = await inOrg(actor, (s) => prepareCarousel(s, input));
  } catch (err) {
    if (err instanceof ModelSelectionError)
      return jsonError(err.message, 422, {
        code: "model_selection",
        reason: err.reason,
        alternatives: err.alternatives,
      });
    if (err instanceof CostConfirmationError)
      return jsonError(err.message, 409, { code: "cost_confirmation", estimateMicros: err.estimateMicros });
    if (err instanceof AppError)
      return jsonError(err.message, errorStatus(err), { code: err.code, fieldErrors: err.fieldErrors });
    console.error("[carrossel] falha ao preparar", err);
    return jsonError("Não foi possível preparar o carrossel.", 500);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runCarouselGeneration(actor, prepared, {
          signal: req.signal,
          send: (e) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")),
        });
      } catch (err) {
        console.error("[carrossel] falha inesperada", err);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              t: "error",
              message: "Falha inesperada ao gerar o carrossel.",
              kind: "internal",
              retryable: true,
            }) + "\n",
          ),
        );
      } finally {
        processEventsInBackground();
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
