import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AiProviderError } from "@/server/ai/types";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import {
  designImageGenRequest,
  prepareDesignImageGeneration,
  recordDesignImageGenError,
  saveDesignImageGeneration,
  type PreparedDesignImageGen,
} from "@/server/services/design-image-gen";

export const runtime = "nodejs";
export const maxDuration = 120;

const orgSlug = z.object({ orgSlug: z.string().min(1).max(64) });
const RETRYABLE = ["rate_limit", "unavailable"];

/**
 * "Gerar imagem" do editor: gera com o modelo de imagem escolhido, recorta
 * para a proporção pedida e salva cada variação em Arquivos (cliente e
 * projeto da arte). Devolve as referências `/api/files/<versão>` para o
 * editor inserir no slide — nada muda na arte por aqui.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const raw = await req.json().catch(() => null);
  const slug = orgSlug.safeParse(raw);
  const parsed = designImageGenRequest.safeParse(raw);
  if (!slug.success || !parsed.success) {
    const fieldErrors = parsed.success ? undefined : z.flattenError(parsed.error).fieldErrors;
    const prompt = parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === "prompt");
    return jsonError(prompt?.message ?? "Pedido inválido.", 400, { fieldErrors });
  }
  const resolved = await actorForRequest(slug.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let prepared: PreparedDesignImageGen;
  try {
    prepared = await inOrg(actor, (s) => prepareDesignImageGeneration(s, parsed.data));
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
    console.error("[editor/gerar-imagem] falha ao preparar", err);
    return jsonError("Não foi possível preparar o pedido.", 500);
  }

  const started = Date.now();
  try {
    const output = await prepared.run(req.signal);
    const latency = Date.now() - started;
    const result = await inOrg(actor, (s) => saveDesignImageGeneration(s, prepared, output, latency));
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const aborted = req.signal.aborted;
    const known = err instanceof AiProviderError || err instanceof AppError;
    const message = known ? err.message : aborted ? "Geração cancelada." : "Falha ao gerar a imagem. Tente novamente.";
    if (!known && !aborted) console.error("[editor/gerar-imagem] erro na geração", err);
    await inOrg(actor, (s) => recordDesignImageGenError(s, prepared, message, Date.now() - started)).catch(
      () => undefined,
    );
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err), { code: err.code });
    const kind = err instanceof AiProviderError ? err.kind : "unavailable";
    const status = kind === "rate_limit" ? 429 : 502;
    return jsonError(message, status, { code: "provider_error", kind, retryable: RETRYABLE.includes(kind) });
  }
}
