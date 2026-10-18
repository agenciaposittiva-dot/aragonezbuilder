import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError, recordUsage } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { runGeneration, type GenerationEvent } from "@/server/services/ai-run";
import {
  designAiRequest,
  normalizeDesignAi,
  prepareDesignAi,
  type PreparedDesignAi,
} from "@/server/services/design-ai";

const orgSlug = z.object({ orgSlug: z.string().min(1).max(64) });

/**
 * Chat de edição de artes: o modelo do seletor universal propõe operações
 * sobre a arte e o servidor devolve a prévia validada (antes/depois e o
 * desfazer). Nada é gravado na arte aqui — a pessoa revisa e aplica depois.
 * Uso, custo e falhas ficam registrados como nas demais gerações.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const raw = await req.json().catch(() => null);
  const slug = orgSlug.safeParse(raw);
  const parsed = designAiRequest.safeParse(raw);
  if (!slug.success || !parsed.success) {
    const fieldErrors = parsed.success ? undefined : z.flattenError(parsed.error).fieldErrors;
    return jsonError("Pedido inválido.", 400, { fieldErrors });
  }
  const resolved = await actorForRequest(slug.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let prepared: PreparedDesignAi;
  try {
    prepared = await inOrg(actor, (s) => prepareDesignAi(s, parsed.data));
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
            operation: "design_edit",
            module: "editor",
            clientId: null,
            status: "blocked",
            errorMessage: err.message,
          }),
        ).catch(() => undefined);
      }
      return jsonError(err.message, errorStatus(err), { code: err.code, fieldErrors: err.fieldErrors });
    }
    console.error("[editor/ia] falha ao preparar", err);
    return jsonError("Não foi possível preparar o pedido.", 500);
  }

  const events: GenerationEvent[] = [];
  await runGeneration(actor, prepared.generation, prepared.input, {
    signal: req.signal,
    send: (e) => events.push(e),
  });
  const meta = events.find((e) => e.t === "meta");
  const done = events.find((e) => e.t === "done");
  if (!done) {
    const failure = events.find((e) => e.t === "error");
    return jsonError(failure?.message ?? "Falha ao gerar. Tente novamente.", 502, {
      code: "provider_error",
      retryable: failure?.retryable ?? true,
    });
  }
  try {
    const result = normalizeDesignAi(prepared.ctx, done.data);
    return Response.json(
      {
        ok: true,
        generationId: done.generationId,
        revision: prepared.ctx.revision,
        result,
        meta: meta
          ? {
              demo: meta.demo,
              providerLabel: meta.providerLabel,
              modelLabel: meta.modelLabel,
              reason: meta.reason,
              warnings: done.notice ? [...meta.warnings, done.notice] : meta.warnings,
              contextUsed: meta.contextUsed,
            }
          : null,
        usage: done.usage,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof AppError ? err.message : "A resposta veio fora do formato esperado.";
    return jsonError(message, 502, { code: "provider_error", retryable: true });
  }
}
