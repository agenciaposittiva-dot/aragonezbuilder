import { z } from "zod";
import { taskAiRequest } from "@/lib/task-ai";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError, recordUsage } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { runGeneration, type GenerationEvent } from "@/server/services/ai-run";
import { normalizeTaskAi, prepareTaskAi, type PreparedTaskAi } from "@/server/services/task-ai";

const orgSlug = z.object({ orgSlug: z.string().min(1).max(64) });

/**
 * Assistente da Central de Tarefas: gera uma proposta (tarefas, subtarefas,
 * prioridade/prazo ou resumo) com o modelo do seletor universal e devolve a
 * prévia normalizada. Nada é gravado aqui — a pessoa revisa e confirma depois.
 * Uso, custo e falhas ficam registrados como nas demais gerações.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const raw = await req.json().catch(() => null);
  const slug = orgSlug.safeParse(raw);
  const parsed = taskAiRequest.safeParse(raw);
  if (!slug.success || !parsed.success) {
    const fieldErrors = parsed.success ? undefined : z.flattenError(parsed.error).fieldErrors;
    return jsonError("Pedido inválido.", 400, { fieldErrors });
  }
  const resolved = await actorForRequest(slug.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let prepared: PreparedTaskAi;
  try {
    prepared = await inOrg(actor, (s) => prepareTaskAi(s, parsed.data));
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
            operation: `task_${parsed.data.mode}`,
            module: "tasks",
            clientId: null,
            status: "blocked",
            errorMessage: err.message,
          }),
        ).catch(() => undefined);
      }
      return jsonError(err.message, errorStatus(err), { fieldErrors: err.fieldErrors });
    }
    console.error("[tarefas/ia] falha ao preparar", err);
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
    const result = normalizeTaskAi(prepared.ctx, done.data);
    return Response.json(
      {
        ok: true,
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
