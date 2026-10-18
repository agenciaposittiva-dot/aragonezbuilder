import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { ModelSelectionError } from "@/server/services/ai-models";
import { CostConfirmationError, generateInput, prepareGeneration, recordUsage } from "@/server/services/ai";
import { runGeneration } from "@/server/services/ai-run";

const body = generateInput.extend({ orgSlug: z.string().min(1).max(64) });

/**
 * Gera conteúdo com o provedor/modelo escolhido (escolha explícita,
 * preferências salvas ou automático), transmitindo o texto em NDJSON
 * ({t:"meta"} {t:"chunk"} ... {t:"done"} | {t:"error"}). Uso, duração e custo
 * (quando há dados) são registrados ao final, inclusive em caso de erro — uma
 * falha nunca é registrada como sucesso.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Pedido inválido.", 400);
  const resolved = await actorForRequest(parsed.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let prepared: Awaited<ReturnType<typeof prepareGeneration>>;
  try {
    prepared = await inOrg(actor, (s) => prepareGeneration(s, parsed.data));
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
    if (err instanceof AppError) {
      if (err.code === "limit") {
        await inOrg(actor, (s) =>
          recordUsage(s, {
            provider: "-",
            model: "-",
            operation: parsed.data.operation,
            module: parsed.data.module,
            clientId: null,
            status: "blocked",
            errorMessage: err.message,
          }),
        ).catch(() => undefined);
      }
      return jsonError(err.message, errorStatus(err), { fieldErrors: err.fieldErrors });
    }
    console.error("[ai] falha ao preparar", err);
    return jsonError("Não foi possível preparar o pedido.", 500);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runGeneration(actor, prepared, parsed.data.input, {
          signal: req.signal,
          send: (e) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")),
        });
      } finally {
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
