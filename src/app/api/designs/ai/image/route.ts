import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AiProviderError } from "@/server/ai/types";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError, recordUsage } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import {
  designImageEditRequest,
  prepareDesignImage,
  saveDesignImage,
  type PreparedDesignImage,
} from "@/server/services/design-ai";

const orgSlug = z.object({ orgSlug: z.string().min(1).max(64) });
const RETRYABLE = ["rate_limit", "unavailable"];

/**
 * Nova versão de uma imagem da arte: a original vai como referência a um
 * modelo que edita imagens (ou, por escolha explícita, gera-se uma imagem
 * nova pela descrição). O resultado vira um arquivo NOVO em Arquivos e volta
 * como operação para a prévia — a arte só muda quando a pessoa aplicar.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const raw = await req.json().catch(() => null);
  const slug = orgSlug.safeParse(raw);
  const parsed = designImageEditRequest.safeParse(raw);
  if (!slug.success || !parsed.success) {
    const fieldErrors = parsed.success ? undefined : z.flattenError(parsed.error).fieldErrors;
    return jsonError("Pedido inválido.", 400, { fieldErrors });
  }
  const resolved = await actorForRequest(slug.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let prepared: PreparedDesignImage;
  try {
    prepared = await inOrg(actor, (s) => prepareDesignImage(s, parsed.data));
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
      return jsonError(err.message, errorStatus(err), { code: err.code, fieldErrors: err.fieldErrors });
    }
    console.error("[editor/ia] falha ao preparar imagem", err);
    return jsonError("Não foi possível preparar o pedido.", 500);
  }

  const started = Date.now();
  try {
    const output = await prepared.run(req.signal);
    const latency = Date.now() - started;
    const result = await inOrg(actor, (s) => saveDesignImage(s, prepared, output, latency));
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const aborted = req.signal.aborted;
    const known = err instanceof AiProviderError || err instanceof AppError;
    const message = known ? err.message : aborted ? "Geração cancelada." : "Falha ao gerar a imagem. Tente novamente.";
    if (!known && !aborted) console.error("[editor/ia] erro na edição de imagem", err);
    await inOrg(actor, (s) =>
      recordUsage(s, {
        provider: prepared.providerId,
        model: prepared.model.id,
        operation: "image_edit",
        module: "editor",
        task: prepared.task,
        selectionSource: prepared.source,
        clientId: prepared.design.clientId,
        projectId: prepared.design.projectId,
        status: "error",
        errorMessage: message,
        latencyMs: Date.now() - started,
      }),
    ).catch(() => undefined);
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err), { code: err.code });
    const kind = err instanceof AiProviderError ? err.kind : "unavailable";
    return jsonError(message, 502, { code: "provider_error", kind, retryable: RETRYABLE.includes(kind) });
  }
}
