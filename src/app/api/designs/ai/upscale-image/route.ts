import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AiProviderError } from "@/server/ai/types";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import {
  designImageUpscaleRequest,
  prepareDesignImageUpscale,
  recordDesignImageUpscaleError,
  saveDesignImageUpscale,
  type PreparedDesignImageUpscale,
} from "@/server/services/design-image-gen";

export const runtime = "nodejs";
export const maxDuration = 120;

const orgSlug = z.object({ orgSlug: z.string().min(1).max(64) });
const RETRYABLE = ["rate_limit", "unavailable"];

/**
 * "Ampliar resolução" do editor: envia a imagem selecionada (de Arquivos) a um
 * modelo que amplia (ex.: Magnific Precision/Creative), salva o resultado em
 * Arquivos e devolve a referência para o editor substituir a imagem. Tarefas
 * assíncronas do provedor são aguardadas aqui (até o limite da rota).
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const raw = await req.json().catch(() => null);
  const slug = orgSlug.safeParse(raw);
  const parsed = designImageUpscaleRequest.safeParse(raw);
  if (!slug.success || !parsed.success) {
    const fieldErrors = parsed.success ? undefined : z.flattenError(parsed.error).fieldErrors;
    return jsonError("Pedido inválido.", 400, { fieldErrors });
  }
  const resolved = await actorForRequest(slug.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let prepared: PreparedDesignImageUpscale;
  try {
    prepared = await inOrg(actor, (s) => prepareDesignImageUpscale(s, parsed.data));
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
    console.error("[editor/ampliar-imagem] falha ao preparar", err);
    return jsonError("Não foi possível preparar o pedido.", 500);
  }

  const started = Date.now();
  try {
    const output = await prepared.run(req.signal);
    const latency = Date.now() - started;
    const result = await inOrg(actor, (s) => saveDesignImageUpscale(s, prepared, output, latency));
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const aborted = req.signal.aborted;
    const known = err instanceof AiProviderError || err instanceof AppError;
    const message = known
      ? err.message
      : aborted
        ? "Ampliação cancelada."
        : "Falha ao ampliar a imagem. Tente novamente.";
    if (!known && !aborted) console.error("[editor/ampliar-imagem] erro na ampliação", err);
    await inOrg(actor, (s) => recordDesignImageUpscaleError(s, prepared, message, Date.now() - started)).catch(
      () => undefined,
    );
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err), { code: err.code });
    const kind = err instanceof AiProviderError ? err.kind : "unavailable";
    const status = kind === "rate_limit" ? 429 : 502;
    return jsonError(message, status, { code: "provider_error", kind, retryable: RETRYABLE.includes(kind) });
  }
}
