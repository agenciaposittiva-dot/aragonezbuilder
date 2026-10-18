import { inOrg, type Actor } from "@/server/authz";
import { AiProviderError, type GenerateResult, type ImageResult } from "@/server/ai/types";
import { AppError } from "@/server/errors";
import { recordUsage, saveGeneration, structuredSchema, type PreparedGeneration } from "./ai";
import { saveImageResult, type PreparedImage } from "./ai-images";

/** Eventos transmitidos ao navegador durante uma geração de texto. */
export type GenerationEvent =
  | {
      t: "meta";
      demo: boolean;
      provider: string;
      providerLabel: string;
      model: string;
      modelLabel: string;
      source: string;
      reason: string;
      warnings: string[];
      contextUsed: boolean;
      structured: boolean;
    }
  | { t: "chunk"; v: string }
  | {
      t: "done";
      generationId: string;
      data: unknown;
      /** Modelo que de fato respondeu (o provedor pode trocar após recusa; nunca escondemos). */
      model: string;
      notice: string | null;
      usage: { inputTokens: number; outputTokens: number; costMicros: number | null; durationMs: number };
    }
  | { t: "error"; message: string; kind: string; retryable: boolean };

const RETRYABLE = ["rate_limit", "unavailable", "bad_request"];

/**
 * Executa a geração com o modelo resolvido e registra o resultado. Sucesso só
 * é registrado (uso + histórico) quando há conteúdo válido; qualquer falha é
 * registrada como erro, com os tokens já consumidos quando o provedor informa.
 */
export async function runGeneration(
  actor: Actor,
  prepared: PreparedGeneration,
  input: Record<string, string>,
  opts: { signal?: AbortSignal; send: (e: GenerationEvent) => void },
) {
  const { send } = opts;
  const usageBase = {
    provider: prepared.providerId,
    model: prepared.model.id,
    operation: prepared.operation,
    module: prepared.module,
    task: prepared.task,
    selectionSource: prepared.source,
    clientId: prepared.clientId,
    projectId: prepared.projectId,
  };
  const started = Date.now();
  send({
    t: "meta",
    demo: prepared.demo,
    provider: prepared.providerId,
    providerLabel: prepared.providerLabel,
    model: prepared.model.id,
    modelLabel: prepared.model.label,
    source: prepared.source,
    reason: prepared.reason,
    warnings: prepared.warnings,
    contextUsed: prepared.contextUsed,
    structured: prepared.structured,
  });
  let result: GenerateResult | null = null;
  try {
    result = await prepared.provider.generate({
      model: prepared.model.id,
      modelCaps: prepared.model.caps,
      system: prepared.system,
      prompt: prepared.prompt,
      maxTokens: prepared.maxTokens,
      jsonSchema: structuredSchema(prepared),
      signal: opts.signal,
      onText: prepared.structured ? undefined : (chunk) => send({ t: "chunk", v: chunk }),
    });
    const output = result;
    if (!output.text.trim())
      throw new AiProviderError("O modelo não devolveu conteúdo. Tente novamente.", "unavailable");
    let data: unknown = undefined;
    if (prepared.structured) {
      try {
        data = JSON.parse(output.text);
      } catch {
        throw new AiProviderError(
          "O modelo devolveu uma resposta fora do formato esperado. Tente novamente.",
          "bad_request",
        );
      }
    }
    const model = output.model || prepared.model.id;
    const durationMs = Date.now() - started;
    const generationId = await inOrg(actor, async (s) => {
      const usageId = await recordUsage(s, {
        ...usageBase,
        model,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        costMicros: output.costMicros,
        status: "success",
        latencyMs: durationMs,
      });
      const title = (input.topic || input.text || prepared.label).split("\n")[0]!.slice(0, 120);
      return saveGeneration(s, {
        usageId,
        kind: prepared.operation,
        title,
        input,
        output: output.text,
        provider: prepared.providerId,
        model,
        clientId: prepared.clientId,
      });
    });
    const changed = !model.startsWith(prepared.model.id);
    send({
      t: "done",
      generationId,
      data,
      model,
      notice: changed ? `O provedor respondeu com ${model} em vez de ${prepared.model.id}.` : null,
      usage: {
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        costMicros: output.costMicros,
        durationMs,
      },
    });
    return { ok: true as const, generationId };
  } catch (err) {
    const aborted = !!opts.signal?.aborted;
    const message =
      err instanceof AiProviderError
        ? err.message
        : aborted
          ? "Geração cancelada."
          : "Falha ao gerar. Tente novamente.";
    if (!(err instanceof AiProviderError) && !aborted) console.error("[ai] erro na geração", err);
    await inOrg(actor, (s) =>
      recordUsage(s, {
        ...usageBase,
        inputTokens: result?.inputTokens ?? null,
        outputTokens: result?.outputTokens ?? null,
        costMicros: result?.costMicros ?? null,
        status: "error",
        errorMessage: message,
        latencyMs: Date.now() - started,
      }),
    ).catch(() => undefined);
    const kind = err instanceof AiProviderError ? err.kind : "unavailable";
    if (!aborted) send({ t: "error", message, kind, retryable: RETRYABLE.includes(kind) });
    return { ok: false as const, message };
  }
}

/**
 * Gera a imagem, salva (Arquivos + histórico) e registra o uso. Em falha,
 * registra o erro e devolve a mensagem — nada é salvo como concluído.
 */
export async function runImage(actor: Actor, prepared: PreparedImage, opts: { signal?: AbortSignal } = {}) {
  const started = Date.now();
  let result: ImageResult | null = null;
  try {
    result = await prepared.run(opts.signal);
    const output = result;
    const latency = Date.now() - started;
    const saved = await inOrg(actor, (s) => saveImageResult(s, prepared, output, latency));
    return { ok: true as const, result: output, saved, durationMs: latency };
  } catch (err) {
    const aborted = !!opts.signal?.aborted;
    const known = err instanceof AiProviderError || err instanceof AppError;
    const message = known ? err.message : aborted ? "Geração cancelada." : "Falha ao gerar a imagem. Tente novamente.";
    if (!known && !aborted) console.error("[ai] erro na geração de imagem", err);
    await inOrg(actor, (s) =>
      recordUsage(s, {
        provider: prepared.providerId,
        model: prepared.model.id,
        operation: "image",
        module: prepared.module,
        task: "image_generation",
        selectionSource: prepared.source,
        clientId: prepared.clientId,
        projectId: prepared.projectId,
        inputTokens: result?.inputTokens ?? null,
        outputTokens: result?.outputTokens ?? null,
        costMicros: result?.costMicros ?? null,
        status: "error",
        errorMessage: message,
        latencyMs: Date.now() - started,
      }),
    ).catch(() => undefined);
    const kind = err instanceof AiProviderError ? err.kind : err instanceof AppError ? "app" : "unavailable";
    return {
      ok: false as const,
      message,
      kind,
      appError: err instanceof AppError ? err : null,
      retryable: kind === "rate_limit" || kind === "unavailable",
    };
  }
}
