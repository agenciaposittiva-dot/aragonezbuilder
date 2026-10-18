import { z } from "zod";
import { inOrg } from "@/server/authz";
import { AiProviderError } from "@/server/ai/types";
import { AppError } from "@/server/errors";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";
import { generateInput, prepareGeneration, recordUsage, saveGeneration, structuredSchema } from "@/server/services/ai";

const body = generateInput.extend({ orgSlug: z.string().min(1).max(64) });

/**
 * Gera conteúdo com o provedor de IA configurado, transmitindo o texto em
 * NDJSON ({t:"chunk"} ... {t:"done"} | {t:"error"}). Uso, custo e o
 * resultado são registrados ao final, inclusive em caso de erro.
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
    if (err instanceof AppError) {
      if (err.code === "limit") {
        await inOrg(actor, (s) =>
          recordUsage(s, {
            provider: "-",
            model: "-",
            operation: parsed.data.operation,
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
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({
        t: "meta",
        demo: prepared.demo,
        model: prepared.model,
        contextUsed: prepared.contextUsed,
        structured: prepared.structured,
      });
      try {
        const result = await prepared.provider.generate({
          model: prepared.model,
          system: prepared.system,
          prompt: prepared.prompt,
          maxTokens: prepared.structured ? 4000 : 8000,
          jsonSchema: structuredSchema(prepared),
          signal: req.signal,
          onText: prepared.structured ? undefined : (chunk) => send({ t: "chunk", v: chunk }),
        });
        const saved = await inOrg(actor, async (s) => {
          const usageId = await recordUsage(s, {
            provider: prepared.provider.id,
            model: result.model,
            operation: prepared.operation,
            clientId: prepared.clientId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costMicros: result.costMicros,
            status: "success",
            latencyMs: Date.now() - started,
          });
          const title = (parsed.data.input.topic || parsed.data.input.text || prepared.label)
            .split("\n")[0]!
            .slice(0, 120);
          const generationId = await saveGeneration(s, {
            usageId,
            kind: prepared.operation,
            title,
            input: parsed.data.input,
            output: result.text,
            provider: prepared.provider.id,
            model: result.model,
            clientId: prepared.clientId,
          });
          return { generationId };
        });
        let data: unknown = undefined;
        if (prepared.structured) {
          try {
            data = JSON.parse(result.text);
          } catch {
            data = null;
          }
        }
        send({
          t: "done",
          generationId: saved.generationId,
          data,
          usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costMicros: result.costMicros },
        });
      } catch (err) {
        const aborted = req.signal.aborted;
        const message =
          err instanceof AiProviderError
            ? err.message
            : aborted
              ? "Geração cancelada."
              : "Falha ao gerar. Tente novamente.";
        if (!(err instanceof AiProviderError) && !aborted) console.error("[ai] erro na geração", err);
        await inOrg(actor, (s) =>
          recordUsage(s, {
            provider: prepared.provider.id,
            model: prepared.model,
            operation: prepared.operation,
            clientId: prepared.clientId,
            status: "error",
            errorMessage: message,
            latencyMs: Date.now() - started,
          }),
        ).catch(() => undefined);
        if (!aborted) send({ t: "error", message });
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
