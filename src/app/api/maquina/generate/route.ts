import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { processEventsInBackground } from "@/server/events/inline";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { prepareCarousel, runCarouselGeneration } from "@/server/services/carousel-generator";
import {
  failMachineGeneration,
  finishMachineGeneration,
  startMachineGeneration,
} from "@/server/services/content-machine";

export const runtime = "nodejs";
// Planejamento + imagens + montagem podem passar de um minuto.
export const maxDuration = 300;

const body = z.object({
  orgSlug: z.string().min(1).max(64),
  id: z.uuid(),
  confirmCost: z.boolean().optional(),
});

/**
 * Gera o conteúdo de um projeto da Máquina com o gerador de carrosséis e
 * transmite o progresso REAL (NDJSON, mesmos eventos do gerador). No fim liga
 * a arte à peça de conteúdo e devolve {t:"machine", contentItemId}.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Pedido inválido.", 422);
  const resolved = await actorForRequest(parsed.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;
  const { id, confirmCost } = parsed.data;

  let prepared: Awaited<ReturnType<typeof prepareCarousel>>;
  try {
    prepared = await inOrg(actor, async (s) => {
      const { request } = await startMachineGeneration(s, id);
      return prepareCarousel(s, { ...request, confirmCost });
    });
  } catch (err) {
    // Confirmação de custo e escolha de modelo não são falhas: a pessoa decide e tenta de novo.
    if (!(err instanceof CostConfirmationError || err instanceof ModelSelectionError))
      await inOrg(actor, (s) => failMachineGeneration(s, id, (err as Error).message)).catch(() => undefined);
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
    console.error("[máquina] falha ao preparar", err);
    return jsonError("Não foi possível preparar a geração.", 500);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const res = await runCarouselGeneration(actor, prepared, { signal: req.signal, send });
        if (res.ok) {
          const linked = await inOrg(actor, (s) => finishMachineGeneration(s, id, res.designId));
          send({ t: "machine", designId: linked.designId, contentItemId: linked.contentItemId });
        } else {
          await inOrg(actor, (s) => failMachineGeneration(s, id, res.message));
        }
      } catch (err) {
        console.error("[máquina] falha inesperada", err);
        await inOrg(actor, (s) => failMachineGeneration(s, id, "Falha inesperada ao gerar.")).catch(() => undefined);
        send({ t: "error", message: "Falha inesperada ao gerar o conteúdo.", kind: "internal", retryable: true });
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
