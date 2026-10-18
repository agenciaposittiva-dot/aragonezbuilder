import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { aiSelectionInput, ModelSelectionError } from "@/server/services/ai-models";
import { StructuredAiError } from "@/server/services/ai-structured";
import { createCarouselVariant, planCarouselRestyle, planCarouselSlide } from "@/server/services/carousel-generator";

export const runtime = "nodejs";
export const maxDuration = 120;

const body = z.object({
  orgSlug: z.string().min(1).max(64),
  designId: z.uuid(),
  tool: z.enum(["carousel_slide", "carousel_direction", "carousel_variant"]),
  pageId: z.string().min(1).max(64).optional(),
  instruction: z.string().trim().max(500).optional(),
  /** Documento do editor (com alterações locais), para calcular sobre o que a pessoa vê. */
  document: z.record(z.string(), z.unknown()).optional(),
  ai: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

/**
 * Ferramentas do gerador de carrosséis para o chat de edição: regenerar um
 * slide e nova direção visual devolvem OPERAÇÕES para a prévia (a arte só
 * muda quando a pessoa aplica no chat); a segunda versão cria uma arte nova
 * (esta não muda) e devolve o endereço dela.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Pedido inválido.", 400);
  const resolved = await actorForRequest(parsed.data.orgSlug);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;
  const d = parsed.data;
  try {
    if (d.tool === "carousel_slide") {
      if (!d.pageId) return jsonError("Informe o slide.", 400);
      const r = await planCarouselSlide(actor, {
        designId: d.designId,
        pageId: d.pageId,
        instruction: d.instruction,
        document: d.document,
        selection: d.ai,
        confirmCost: d.confirmCost,
      });
      return Response.json({ ok: true, result: { ops: r.ops, generationId: r.generationId, fileId: null, data: r } });
    }
    if (d.tool === "carousel_direction") {
      const r = await inOrg(actor, (s) => planCarouselRestyle(s, { designId: d.designId, document: d.document }));
      return Response.json({ ok: true, result: { ops: r.ops, generationId: null, fileId: null, data: r } });
    }
    const r = await inOrg(actor, (s) => createCarouselVariant(s, { designId: d.designId, document: d.document }));
    return Response.json({ ok: true, result: { ops: [], generationId: null, fileId: null, data: r } });
  } catch (err) {
    if (err instanceof ModelSelectionError)
      return jsonError(err.message, 422, {
        code: "model_selection",
        reason: err.reason,
        alternatives: err.alternatives,
      });
    if (err instanceof CostConfirmationError)
      return jsonError(err.message, 409, { code: "cost_confirmation", estimateMicros: err.estimateMicros });
    if (err instanceof StructuredAiError)
      return jsonError(err.message, 502, { code: "provider_error", kind: err.kind });
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err), { code: err.code });
    console.error("[editor/ia] falha na ferramenta do carrossel", err);
    return jsonError("Não foi possível concluir. Tente novamente.", 500);
  }
}
