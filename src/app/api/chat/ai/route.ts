import { NextResponse } from "next/server";
import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { CostConfirmationError } from "@/server/services/ai";
import { ModelSelectionError } from "@/server/services/ai-models";
import { runGeneration, type GenerationEvent } from "@/server/services/ai-run";
import { chatAiInput, prepareChatAi } from "@/server/services/chat-ai";

export const runtime = "nodejs";

const body = chatAiInput.extend({ org: z.string().min(1).max(64) });

/**
 * IA no chat com o seletor universal de modelos (resumos, decisões, tarefas
 * sugeridas, resposta, reescrita e perguntas). Resposta JSON ao final; erros
 * de modelo, custo e permissão voltam com `code` para a interface tratar.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Pedido inválido.", 400);
  const resolved = await actorForRequest(parsed.data.org);
  if ("response" in resolved) return resolved.response;
  const { actor } = resolved;

  let ready: Awaited<ReturnType<typeof prepareChatAi>>;
  try {
    ready = await inOrg(actor, (s) => prepareChatAi(s, parsed.data));
  } catch (err) {
    if (err instanceof ModelSelectionError) {
      return jsonError(err.message, 422, { code: "model_selection", alternatives: err.alternatives });
    }
    if (err instanceof CostConfirmationError) {
      return jsonError(err.message, 409, { code: "cost_confirmation", estimateMicros: err.estimateMicros });
    }
    if (err instanceof AppError) return jsonError(err.message, errorStatus(err), { code: err.code });
    console.error("[chat-ia] falha ao preparar", err);
    return jsonError("Não foi possível preparar o pedido.", 500);
  }

  const events: GenerationEvent[] = [];
  await runGeneration(actor, ready.prepared, ready.stored, { signal: req.signal, send: (e) => events.push(e) });
  const done = events.find((e): e is Extract<GenerationEvent, { t: "done" }> => e.t === "done");
  const failure = events.find((e): e is Extract<GenerationEvent, { t: "error" }> => e.t === "error");
  const meta = events.find((e): e is Extract<GenerationEvent, { t: "meta" }> => e.t === "meta");
  if (failure || !done) {
    return jsonError(failure?.message ?? "A IA não respondeu. Tente novamente.", 502, {
      code: failure?.kind ?? "unavailable",
      retryable: failure?.retryable ?? true,
    });
  }
  const text = events
    .filter((e): e is Extract<GenerationEvent, { t: "chunk" }> => e.t === "chunk")
    .map((e) => e.v)
    .join("");
  return NextResponse.json({
    ok: true,
    data: {
      text,
      data: done.data ?? null,
      model: done.model,
      provider: meta?.providerLabel ?? ready.prepared.providerLabel,
      demo: ready.prepared.demo,
      notice: done.notice,
      usage: done.usage,
    },
  });
}
