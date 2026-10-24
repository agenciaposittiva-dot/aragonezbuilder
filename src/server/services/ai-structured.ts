import { z } from "zod";
import type { AiTask } from "@/lib/ai-tasks";
import { PROVIDER_LABEL } from "@/lib/ai-select";
import { inOrg, type Actor, type Scope } from "@/server/authz";
import { AiProviderError, type GenerateRequest } from "@/server/ai/types";
import { AppError } from "@/server/errors";
import { assertCanGenerate, CostConfirmationError, estimateMaxCostMicros, recordUsage, saveGeneration } from "./ai";
import { aiSelectionInput, ModelSelectionError, resolveSelection } from "./ai-models";

/*
 * Chamada estruturada (JSON) com o modelo escolhido pelo seletor universal:
 * prepara (permissão, limites, modelo compatível), confirma custo acima do
 * limite da organização, chama o provedor FORA de transação, valida a
 * resposta e registra uso — sucesso só com conteúdo válido; falha sempre
 * registrada como erro. Nunca troca de provedor em silêncio: o modelo que
 * respondeu volta junto.
 */

export class StructuredAiError extends AppError {
  constructor(
    message: string,
    readonly kind: string,
  ) {
    super(message, "conflict");
    this.name = "StructuredAiError";
  }
}

export type PreparedStructured = {
  provider: ReturnType<NonNullable<Awaited<ReturnType<typeof resolveSelection>>["def"]["text"]>>;
  providerId: string;
  providerLabel: string;
  model: Awaited<ReturnType<typeof resolveSelection>>["model"];
  source: string;
  keySource: string | null;
  reason: string;
  warnings: string[];
  demo: boolean;
  module: string;
  task: AiTask;
  /** A organização autorizou enviar dados de clientes ao provedor (demo é local). */
  allowClientContext: boolean;
  confirmAboveMicros: number;
};

export async function prepareStructured(
  s: Scope,
  o: { module: string; task: AiTask; selection?: z.input<typeof aiSelectionInput> },
): Promise<PreparedStructured> {
  const settings = await assertCanGenerate(s);
  const resolved = await resolveSelection(s, { module: o.module, task: o.task, selection: o.selection });
  const def = resolved.def;
  if (!def.text)
    throw new ModelSelectionError(`${def.label} não gera texto. Escolha um modelo de texto.`, "model_incompatible");
  return {
    provider: def.text(resolved.apiKey ?? "", { baseUrl: resolved.baseUrl }),
    providerId: def.id,
    providerLabel: PROVIDER_LABEL[def.id] ?? def.label,
    model: resolved.model,
    source: resolved.source,
    keySource: resolved.keySource,
    reason: resolved.reason,
    warnings: resolved.warnings,
    demo: def.id === "demo",
    module: o.module,
    task: o.task,
    allowClientContext: settings.allowClientContext || def.id === "demo",
    confirmAboveMicros: settings.confirmAboveMicros,
  };
}

/** Pede confirmação quando a estimativa passa do limite da organização. */
export function assertCostConfirmed(
  prep: PreparedStructured,
  req: { system: string; prompt: string; maxTokens: number; images?: number; confirmCost?: boolean },
) {
  const maxTokens = Math.min(req.maxTokens, prep.model.maxOutputTokens ?? req.maxTokens);
  // Imagem anexada: ~1.600 tokens de entrada cada (estimativa conservadora).
  const chars = req.system.length + req.prompt.length + (req.images ?? 0) * 6400;
  const estimate = estimateMaxCostMicros(prep.model, chars, maxTokens);
  if (prep.confirmAboveMicros > 0 && estimate !== null && estimate > prep.confirmAboveMicros && !req.confirmCost)
    throw new CostConfirmationError(estimate);
  return maxTokens;
}

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AiProviderError(
      "O modelo devolveu uma resposta fora do formato esperado. Tente novamente.",
      "bad_request",
    );
  }
}

export type StructuredCall<T> = {
  data: T;
  model: string;
  raw: string;
  tokens: { inputTokens: number; outputTokens: number; costMicros: number | null };
  latency: number;
  usage: {
    provider: string;
    model: string;
    operation: string;
    module: string;
    task: string;
    selectionSource: string;
    clientId: string | null;
  };
};

export async function callStructured<T>(
  actor: Actor,
  prep: PreparedStructured,
  req: {
    operation: string;
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    parse: z.ZodType<T>;
    clientId: string | null;
    maxTokens: number;
    images?: GenerateRequest["images"];
    confirmCost?: boolean;
    signal?: AbortSignal;
  },
): Promise<StructuredCall<T>> {
  const maxTokens = assertCostConfirmed(prep, { ...req, images: req.images?.length });
  const started = Date.now();
  const usage = {
    provider: prep.providerId,
    keySource: prep.keySource,
    model: prep.model.id,
    operation: req.operation,
    module: prep.module,
    task: prep.task,
    selectionSource: prep.source,
    clientId: req.clientId,
  };
  let tokens: { inputTokens: number; outputTokens: number; costMicros: number | null } | null = null;
  try {
    const result = await prep.provider.generate({
      model: prep.model.id,
      modelCaps: prep.model.caps,
      system: req.system,
      prompt: req.prompt,
      maxTokens,
      jsonSchema: req.schema,
      images: req.images,
      signal: req.signal,
    });
    tokens = result;
    const parsed = req.parse.safeParse(parseJson(result.text));
    if (!parsed.success)
      throw new AiProviderError("O modelo devolveu campos incompletos. Tente novamente.", "bad_request");
    return {
      data: parsed.data,
      model: result.model || prep.model.id,
      raw: result.text,
      tokens: result,
      latency: Date.now() - started,
      usage,
    };
  } catch (err) {
    const aborted = !!req.signal?.aborted;
    const message =
      err instanceof AiProviderError
        ? err.message
        : aborted
          ? "Geração cancelada."
          : "Falha ao consultar a IA. Tente novamente.";
    if (!(err instanceof AiProviderError) && !aborted) console.error("[ia] erro na chamada estruturada", err);
    await inOrg(actor, (s) =>
      recordUsage(s, {
        ...usage,
        inputTokens: tokens?.inputTokens ?? null,
        outputTokens: tokens?.outputTokens ?? null,
        costMicros: tokens?.costMicros ?? null,
        status: "error",
        errorMessage: message,
        latencyMs: Date.now() - started,
      }),
    ).catch(() => undefined);
    throw new StructuredAiError(
      message,
      err instanceof AiProviderError ? err.kind : aborted ? "aborted" : "unavailable",
    );
  }
}

export async function recordStructuredSuccess(
  s: Scope,
  call: StructuredCall<unknown>,
  g: { title: string; input: Record<string, unknown>; clientId: string | null },
) {
  const usageId = await recordUsage(s, {
    ...call.usage,
    model: call.model,
    inputTokens: call.tokens.inputTokens,
    outputTokens: call.tokens.outputTokens,
    costMicros: call.tokens.costMicros,
    status: "success",
    latencyMs: call.latency,
  });
  return saveGeneration(s, {
    usageId,
    kind: call.usage.operation,
    title: g.title,
    input: g.input,
    output: call.raw,
    provider: call.usage.provider,
    model: call.model,
    clientId: g.clientId,
  });
}

/** Aviso quando o provedor respondeu com outro modelo (nunca escondemos). */
export function modelNotice(prep: PreparedStructured, model: string) {
  return model.startsWith(prep.model.id) ? null : `O provedor respondeu com ${model} em vez de ${prep.model.id}.`;
}
