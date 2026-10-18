import { z } from "zod";
import { AI_MODULES, type AiModelInfo } from "@/lib/ai-tasks";
import { PROVIDER_LABEL } from "@/lib/ai-select";
import { assertClientAccess, assertProjectAccess, can, type Scope } from "@/server/authz";
import type { ImageResult } from "@/server/ai/types";
import { assertCanGenerate, CostConfirmationError, recordUsage, saveGeneration } from "./ai";
import { aiSelectionInput, ModelSelectionError, resolveSelection } from "./ai-models";
import { storeUpload } from "./files";

/** Tamanhos aceitos pela Images API da OpenAI para os modelos gpt-image. */
export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"] as const;

export const imageInput = z.object({
  prompt: z.string().trim().min(3, "Descreva a imagem.").max(4000),
  size: z.enum(IMAGE_SIZES).default("1024x1024"),
  clientId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  module: z.enum(Object.keys(AI_MODULES) as [string, ...string[]]).default("art"),
  selection: aiSelectionInput.optional(),
  /** Salva a imagem na Central de Arquivos (exige permissão de envio). */
  saveToFiles: z.boolean().default(true),
  confirmCost: z.boolean().optional(),
});

export type PreparedImage = {
  prompt: string;
  size: (typeof IMAGE_SIZES)[number];
  model: AiModelInfo;
  providerId: string;
  providerLabel: string;
  source: string;
  reason: string;
  warnings: string[];
  module: string;
  clientId: string | null;
  projectId: string | null;
  saveToFiles: boolean;
  run: (signal?: AbortSignal) => Promise<ImageResult>;
};

/**
 * Valida o pedido de imagem e resolve um modelo de geração de imagem. Modelos
 * de texto nunca são usados no lugar: sem modelo visual habilitado, o erro
 * explica o motivo e lista as alternativas compatíveis. Somente a descrição
 * digitada é enviada ao provedor (nenhum dado do cliente é anexado).
 */
export async function prepareImage(s: Scope, raw: z.input<typeof imageInput>): Promise<PreparedImage> {
  const data = imageInput.parse(raw);
  const settings = await assertCanGenerate(s);
  const resolved = await resolveSelection(s, {
    module: data.module,
    task: "image_generation",
    selection: data.selection,
  });
  const def = resolved.def;
  if (!def.image) {
    throw new ModelSelectionError(
      `${PROVIDER_LABEL[def.id] ?? def.label} não gera imagens nesta versão. Escolha um modelo de imagem.`,
      "model_incompatible",
    );
  }
  let clientId = data.clientId ?? null;
  if (data.projectId) {
    const p = await assertProjectAccess(s, data.projectId);
    clientId = p.clientId;
  }
  if (clientId) await assertClientAccess(s, clientId);
  // A Images API não informa preço: com aviso de custo configurado, pedimos confirmação.
  if (settings.confirmAboveMicros > 0 && !data.confirmCost) throw new CostConfirmationError(null);

  const apiKey = resolved.apiKey ?? "";
  const generate = def.image;
  return {
    prompt: data.prompt,
    size: data.size,
    model: resolved.model,
    providerId: def.id,
    providerLabel: def.label,
    source: resolved.source,
    reason: resolved.reason,
    warnings: resolved.warnings,
    module: data.module,
    clientId,
    projectId: data.projectId ?? null,
    saveToFiles: data.saveToFiles && can(s.actor, "files.write"),
    run: (signal) => generate(apiKey, { model: resolved.model.id, prompt: data.prompt, size: data.size, signal }),
  };
}

/** Registra o uso, salva as imagens em Arquivos (quando permitido) e o histórico. */
export async function saveImageResult(s: Scope, prepared: PreparedImage, result: ImageResult, latencyMs: number) {
  const usageId = await recordUsage(s, {
    provider: prepared.providerId,
    model: result.model,
    operation: "image",
    module: prepared.module,
    task: "image_generation",
    selectionSource: prepared.source,
    clientId: prepared.clientId,
    projectId: prepared.projectId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costMicros: result.costMicros,
    status: "success",
    latencyMs,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const saved: { fileId: string; versionId: string }[] = [];
  if (prepared.saveToFiles) {
    for (const [i, buffer] of result.images.entries()) {
      const file = await storeUpload(
        s,
        { buffer, originalName: `ia-imagem-${stamp}${result.images.length > 1 ? `-${i + 1}` : ""}.png` },
        {
          clientId: prepared.clientId,
          projectId: prepared.projectId,
          category: "general",
          tags: ["ia"],
          note: `Gerada por IA (${result.model}): ${prepared.prompt}`.slice(0, 500),
          source: "ai",
        },
      );
      saved.push({ fileId: file.fileId, versionId: file.versionId });
    }
  }
  const generationId = await saveGeneration(s, {
    usageId,
    kind: "image",
    title: prepared.prompt.split("\n")[0]!.slice(0, 120),
    input: { prompt: prepared.prompt, size: prepared.size },
    output: saved.length
      ? `Imagem gerada e salva em Arquivos (${saved.length}).`
      : "Imagem gerada (não salva em Arquivos).",
    provider: prepared.providerId,
    model: result.model,
    clientId: prepared.clientId,
  });
  return { generationId, files: saved };
}
