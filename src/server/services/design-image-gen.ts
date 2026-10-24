import "server-only";
import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { fileSrc, readDesignDocument, type DesignDocument, type DesignObject, type DesignPage } from "@/lib/design-doc";
import { PROVIDER_LABEL } from "@/lib/ai-select";
import type { AiModelInfo } from "@/lib/ai-tasks";
import {
  buildImagePrompt,
  cropToRatio,
  IMAGE_CONTEXT_LABEL,
  IMAGE_FORMAT_KEYS,
  IMAGE_GEN_LIMITS,
  IMAGE_STYLE_KEYS,
  IMAGE_STYLES,
  imageProviderOptions,
  providerSizeFor,
  ratioLabel,
  ratioOf,
  sizeParam,
  type ImageContextMode,
  type ImageFormatKey,
  type ImageStyleKey,
  type Ratio,
} from "@/lib/image-gen";
import { assertCan, assertInternal, can, fileScope, inOrg, type Actor, type Scope } from "@/server/authz";
import { AiProviderError, type ImageResult } from "@/server/ai/types";
import { aiGenerations, clients, files, fileVersions, user } from "@/server/db/schema";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { assertCanGenerate, CostConfirmationError, recordUsage, saveGeneration } from "./ai";
import { aiSelectionInput, ModelSelectionError, resolveSelection } from "./ai-models";
import { callStructured, modelNotice, prepareStructured, recordStructuredSuccess } from "./ai-structured";
import { getBrandProfile } from "./clients";
import { POLICY_MESSAGE } from "./design-ai";
import { getDesign } from "./designs";
import { storeUpload } from "./files";

/*
 * "Gerar imagem" do Estúdio Criador: cria imagens por IA sem sair do editor.
 * O modelo vem do seletor universal (módulo "editor", tarefa
 * image_generation) e só provedores com geração de imagem confirmada servem.
 * Cada imagem gerada é importada para a Central de Arquivos (cliente e
 * projeto da arte, origem "ai", com a descrição e o modelo na nota) — nunca
 * fica só a URL do provedor — e volta como `/api/files/<versão>` para o
 * editor inserir pelo caminho normal (operações, desfazer, salvamento
 * automático). O contexto do slide/carrossel é opcional e respeita a política
 * de dados de clientes da organização.
 */

const MODULE = "editor";
const OPERATION = "image_generate";

const ratioInput = z.object({
  w: z.number().min(1).max(IMAGE_GEN_LIMITS.customRatio),
  h: z.number().min(1).max(IMAGE_GEN_LIMITS.customRatio),
});

export const designImageGenRequest = z.object({
  designId: z.uuid(),
  prompt: z.string().trim().min(3, "Descreva a imagem.").max(IMAGE_GEN_LIMITS.prompt),
  format: z.enum(IMAGE_FORMAT_KEYS).default("page"),
  /** Proporção personalizada (só com format = "custom"). */
  customRatio: ratioInput.nullish(),
  style: z.enum(IMAGE_STYLE_KEYS).default("none"),
  /** Qualidade no vocabulário do provedor (validada contra as opções dele). */
  quality: z.string().trim().max(20).nullish(),
  variations: z.number().int().min(1).max(IMAGE_GEN_LIMITS.variations).default(1),
  negativePrompt: z.string().trim().max(IMAGE_GEN_LIMITS.negativePrompt).nullish(),
  context: z.enum(["none", "slide", "carousel"]).default("none"),
  /** Estado atual do editor (pode ter alterações não salvas): base do contexto. */
  document: z.record(z.string(), z.unknown()).optional(),
  pageId: z.string().max(64).optional(),
  ai: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});
export type DesignImageGenInput = z.input<typeof designImageGenRequest>;

async function loadEditable(s: Scope, designId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const current = await getDesign(s, designId);
  if (current.design.isTemplate) assertCan(s.actor, "templates.manage");
  return current;
}

function docFrom(raw: Record<string, unknown> | undefined, d: { document: unknown; width: number; height: number }) {
  return readDesignDocument(raw ?? d.document, { width: d.width, height: d.height }).doc;
}

/* ------------------------------------------------------------------ */
/* Contexto do slide / carrossel                                       */
/* ------------------------------------------------------------------ */

export type ImageContextInput = {
  doc: DesignDocument;
  pageId: string | null;
  mode: ImageContextMode;
  design: { name: string };
  clientName: string | null;
  brand: {
    colors: string[];
    fonts: string[];
    toneOfVoice: string | null;
    audience: string | null;
    keywords: string[];
    avoid: string | null;
  } | null;
  /** Descrições de imagens geradas antes nesta arte (continuidade visual). */
  previousPrompts: string[];
};

const short = (t: string, n: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function textsOf(objects: DesignObject[]): string[] {
  const out: string[] = [];
  const walk = (list: DesignObject[]) => {
    for (const o of list) {
      if (o.hidden) continue;
      if (o.type === "text" && o.text.trim()) out.push(o.text);
      if (o.type === "group") walk(o.children);
    }
  };
  walk(objects);
  return out;
}

function countVisuals(objects: DesignObject[]) {
  let images = 0;
  let shapes = 0;
  const walk = (list: DesignObject[]) => {
    for (const o of list) {
      if (o.hidden) continue;
      if (o.type === "image") images++;
      else if (o.type === "group") walk(o.children);
      else if (o.type !== "text") shapes++;
    }
  };
  walk(objects);
  return { images, shapes };
}

function slideLines(doc: DesignDocument, page: DesignPage, index: number, label: string) {
  const texts = textsOf(page.objects);
  // Textos em ordem de tamanho de fonte: o maior costuma ser o título.
  const { images, shapes } = countVisuals(page.objects);
  const lines = [`${label} ${index + 1} de ${doc.pages.length}${page.name ? ` ("${page.name}")` : ""}:`];
  if (texts.length) lines.push(`- Textos: ${texts.map((t) => `"${short(t, 160)}"`).join("; ")}`);
  else lines.push("- Sem textos ainda.");
  const existing = [images ? `${images} imagem(ns)` : "", shapes ? `${shapes} forma(s)` : ""].filter(Boolean);
  if (existing.length) lines.push(`- Elementos já no slide: ${existing.join(", ")}`);
  lines.push(`- Tamanho: ${page.width}×${page.height} px`);
  return lines;
}

/**
 * Contexto em texto para o prompt da imagem (só quando a pessoa ativa):
 * do slide atual (textos, assunto, elementos, tamanho) ou do carrossel inteiro
 * (tema, narrativa, sequência dos slides, imagens anteriores) + identidade
 * visual do cliente (quando enviada). Puro: a política é aplicada antes.
 */
export function describeImageContext(c: ImageContextInput): string | null {
  if (c.mode === "none") return null;
  const doc = c.doc;
  const carousel = !!doc.meta?.carousel || doc.pages.length > 1;
  const label = carousel ? "Slide" : "Página";
  const pageIndex = Math.max(0, c.pageId ? doc.pages.findIndex((p) => p.id === c.pageId) : 0);
  const page = doc.pages[pageIndex] ?? doc.pages[0]!;
  const lines: string[] = [
    `Contexto (${IMAGE_CONTEXT_LABEL[c.mode].toLowerCase()}) — a imagem será usada numa arte editável; os textos do slide ficam como camadas por cima, então NÃO escreva textos nem logotipos na imagem.`,
    `Arte: "${short(c.design.name, 120)}"${c.clientName ? ` para o cliente "${short(c.clientName, 80)}"` : ""}.`,
  ];
  const gen = doc.meta?.generator;
  if (c.mode === "carousel" && carousel) {
    if (gen) {
      lines.push(`Tema do carrossel: ${short(gen.plan.title || gen.input.topic, 200)}`);
      if (gen.plan.objective || gen.input.objective)
        lines.push(`Objetivo: ${short(gen.plan.objective || gen.input.objective, 300)}`);
      if (gen.plan.audience || gen.input.audience)
        lines.push(`Público: ${short(gen.plan.audience || gen.input.audience, 300)}`);
      if (gen.plan.narrative) lines.push(`Narrativa: ${short(gen.plan.narrative, 400)}`);
      if (gen.direction?.name) lines.push(`Direção de arte: ${short(gen.direction.name, 120)}`);
    }
    const sequence = doc.pages.map((p, i) => {
      const t = textsOf(p.objects);
      return `${i + 1}. ${t.length ? `"${short(t[0]!, 90)}"` : "(sem texto)"}`;
    });
    lines.push(`Sequência dos slides: ${sequence.join(" → ")}`);
  }
  lines.push(...slideLines(doc, page, pageIndex, label));
  lines.push(
    `Papel da imagem: complementar a mensagem deste ${label.toLowerCase()} com continuidade visual em relação ${
      c.mode === "carousel" ? "aos demais slides" : "ao conteúdo"
    }.`,
  );
  if (c.previousPrompts.length) {
    lines.push(
      `Imagens já geradas nesta arte (mantenha coerência de estilo): ${c.previousPrompts
        .slice(0, 3)
        .map((p) => `"${short(p, 160)}"`)
        .join("; ")}`,
    );
  }
  if (c.brand) {
    const b = c.brand;
    const parts = [
      b.colors.length ? `cores ${b.colors.slice(0, 6).join(", ")}` : "",
      b.fonts.length ? `tipografia ${b.fonts.slice(0, 3).join(", ")}` : "",
      b.toneOfVoice ? `tom de voz ${short(b.toneOfVoice, 160)}` : "",
      b.audience ? `público ${short(b.audience, 160)}` : "",
      b.keywords.length ? `palavras-chave ${b.keywords.slice(0, 8).join(", ")}` : "",
    ].filter(Boolean);
    if (parts.length)
      lines.push(
        `Identidade visual (use como referência de clima e paleta; não reproduza logotipos nem altere cores institucionais): ${parts.join("; ")}.`,
      );
    if (b.avoid) lines.push(`Evitar na marca: ${short(b.avoid, 200)}`);
  }
  return lines.join("\n");
}

/** Descrições das últimas imagens geradas nesta arte (para continuidade entre slides). */
async function previousPrompts(s: Scope, designId: string, limit = 3): Promise<string[]> {
  const rows = await s.db
    .select({ input: aiGenerations.input })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.kind, OPERATION), sql`${aiGenerations.input}->>'designId' = ${designId}`))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(limit);
  return rows
    .map((r) => String((r.input as Record<string, unknown>).prompt ?? ""))
    .filter(Boolean)
    .reverse();
}

async function brandFor(s: Scope, clientId: string | null): Promise<ImageContextInput["brand"]> {
  if (!clientId || !can(s.actor, "clients.read")) return null;
  const b = await getBrandProfile(s, clientId).catch(() => null);
  if (!b) return null;
  return {
    colors: b.colors.map((c) => c.hex),
    fonts: b.fonts.map((f) => f.name),
    toneOfVoice: b.toneOfVoice || null,
    audience: b.audience || null,
    keywords: b.keywords ?? [],
    avoid: b.avoid || null,
  };
}

/* ------------------------------------------------------------------ */
/* Preparação (validação, modelo, permissões, política, custo)         */
/* ------------------------------------------------------------------ */

export type PreparedDesignImageGen = {
  design: { id: string; name: string; clientId: string | null; projectId: string | null };
  /** Descrição digitada pela pessoa. */
  prompt: string;
  /** Texto final enviado ao provedor (descrição + estilo + contexto). */
  finalPrompt: string;
  format: ImageFormatKey;
  ratio: Ratio;
  /** Tamanho pedido à API e medidas finais depois do recorte. */
  size: { w: number; h: number };
  output: { width: number; height: number };
  style: ImageStyleKey;
  quality: string | null;
  variations: number;
  context: ImageContextMode;
  contextUsed: boolean;
  pageId: string | null;
  model: AiModelInfo;
  providerId: string;
  providerLabel: string;
  source: string;
  reason: string;
  warnings: string[];
  run: (signal?: AbortSignal) => Promise<ImageResult>;
};

export async function prepareDesignImageGeneration(
  s: Scope,
  raw: DesignImageGenInput,
): Promise<PreparedDesignImageGen> {
  const data = designImageGenRequest.parse(raw);
  const { design: d, clientName } = await loadEditable(s, data.designId);
  if (!can(s.actor, "files.write")) {
    throw new ForbiddenError("Você não tem permissão para salvar imagens em Arquivos — necessário para gerar imagens.");
  }
  const doc = docFrom(data.document, d);
  const page = (data.pageId && doc.pages.find((p) => p.id === data.pageId)) || doc.pages[0]!;
  const ratio = ratioOf(data.format, page, data.customRatio ?? null);
  if (!ratio) throw new ValidationError("Proporção inválida. Escolha um formato ou informe uma proporção válida.");

  const settings = await assertCanGenerate(s);
  const resolved = await resolveSelection(s, { module: MODULE, task: "image_generation", selection: data.ai });
  const def = resolved.def;
  const providerLabel = PROVIDER_LABEL[def.id] ?? def.label;
  const generate = def.image;
  const options = imageProviderOptions(def.id);
  if (!generate || !options) {
    throw new ModelSelectionError(
      `${providerLabel} não gera imagens nesta versão. Escolha um modelo de geração de imagens (ex.: OpenAI gpt-image).`,
      "model_incompatible",
    );
  }
  // Opções dinâmicas: só o que o provedor escolhido aceita.
  const quality = data.quality || null;
  if (quality && (!options.qualities || !(quality in options.qualities))) {
    throw new ValidationError(`${providerLabel} não aceita a qualidade "${quality}".`, { quality: ["Inválida"] });
  }
  if (data.variations > options.maxVariations) {
    throw new ValidationError(`${providerLabel} gera no máximo ${options.maxVariations} variações por vez.`, {
      variations: ["Acima do limite"],
    });
  }
  if (data.negativePrompt && !options.negativePrompt) {
    throw new ValidationError(`${providerLabel} não aceita instruções negativas neste modelo.`, {
      negativePrompt: ["Não suportado"],
    });
  }
  // Política de dados: o conteúdo de uma arte de cliente só vai ao provedor com autorização.
  const demo = def.id === "demo";
  if (data.context !== "none" && d.clientId && !demo && !settings.allowClientContext) {
    throw new ValidationError(POLICY_MESSAGE, { context: ["Não autorizado"] });
  }
  let context: string | null = null;
  if (data.context !== "none") {
    context = describeImageContext({
      doc,
      pageId: page.id,
      mode: data.context,
      design: { name: d.name },
      clientName: clientName ?? null,
      brand: await brandFor(s, d.clientId),
      previousPrompts: await previousPrompts(s, d.id),
    });
  }
  // A Images API não informa preço: com aviso de custo configurado, pedimos confirmação.
  if (!demo && settings.confirmAboveMicros > 0 && !data.confirmCost) throw new CostConfirmationError(null);

  const size = providerSizeFor(ratio, options.sizes);
  const crop = cropToRatio(size, ratio);
  const finalPrompt = buildImagePrompt({
    prompt: data.prompt,
    style: data.style,
    negativePrompt: data.negativePrompt ?? null,
    context,
  });
  const apiKey = resolved.apiKey ?? "";
  const n = data.variations;
  return {
    design: { id: d.id, name: d.name, clientId: d.clientId, projectId: d.projectId },
    prompt: data.prompt,
    finalPrompt,
    format: data.format,
    ratio,
    size,
    output: { width: crop.width, height: crop.height },
    style: data.style,
    quality,
    variations: n,
    context: data.context,
    contextUsed: !!context,
    pageId: page.id,
    model: resolved.model,
    providerId: def.id,
    providerLabel,
    source: resolved.source,
    reason: resolved.reason,
    warnings: resolved.warnings,
    run: (signal) =>
      generate(apiKey, {
        model: resolved.model.id,
        prompt: finalPrompt,
        size: sizeParam(size),
        n,
        ...(quality ? { quality } : {}),
        signal,
      }),
  };
}

/* ------------------------------------------------------------------ */
/* Resultado: recorte, Arquivos, uso e histórico                       */
/* ------------------------------------------------------------------ */

export type GeneratedImage = {
  fileId: string;
  versionId: string;
  /** "/api/files/<versão>" — como as demais imagens da arte. */
  src: string;
  width: number;
  height: number;
};

export type DesignImageGenResult = {
  generationId: string;
  provider: string;
  providerLabel: string;
  model: string;
  modelLabel: string;
  prompt: string;
  finalPrompt: string;
  format: ImageFormatKey;
  ratio: string;
  contextUsed: boolean;
  pageId: string | null;
  images: GeneratedImage[];
  warnings: string[];
  /** O provedor respondeu com outro modelo (nunca escondemos). */
  notice: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null; costMicros: number | null; durationMs: number };
};

/** Nota gravada na versão do arquivo (a biblioteca de imagens geradas lê daqui). */
export function imageNote(model: string, designName: string, prompt: string) {
  return `Gerada por IA (${model}) na arte "${designName}": ${prompt}`.slice(0, 500);
}

/**
 * Recorta cada imagem para a proporção pedida, salva como arquivo novo em
 * Arquivos (cliente/projeto da arte, origem "ai"), registra o uso e o
 * histórico. Nada entra na arte aqui: o editor insere pelo caminho normal.
 */
export async function saveDesignImageGeneration(
  s: Scope,
  prepared: PreparedDesignImageGen,
  result: ImageResult,
  latencyMs: number,
): Promise<DesignImageGenResult> {
  if (!result.images.length)
    throw new AiProviderError("O provedor não devolveu imagem. Tente novamente.", "unavailable");
  const { design: d } = prepared;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const images: GeneratedImage[] = [];
  for (const [i, raw] of result.images.entries()) {
    const meta = await sharp(raw).metadata();
    const w = meta.width ?? prepared.size.w;
    const h = meta.height ?? prepared.size.h;
    const crop = cropToRatio({ w, h }, prepared.ratio);
    const needsCrop = crop.width !== w || crop.height !== h;
    const buffer = needsCrop ? await sharp(raw).extract(crop).png().toBuffer() : raw;
    const stored = await storeUpload(
      s,
      {
        buffer,
        originalName: `ia-imagem-${stamp}${result.images.length > 1 ? `-${i + 1}` : ""}.png`,
      },
      {
        clientId: d.clientId,
        projectId: d.projectId,
        category: "general",
        tags: ["ia", "estudio"],
        note: imageNote(result.model, d.name, prepared.prompt),
        source: "ai",
      },
    );
    images.push({
      fileId: stored.fileId,
      versionId: stored.versionId,
      src: fileSrc(stored.versionId),
      width: crop.width,
      height: crop.height,
    });
  }
  const usageId = await recordUsage(s, {
    provider: prepared.providerId,
    model: result.model,
    operation: OPERATION,
    module: MODULE,
    task: "image_generation",
    selectionSource: prepared.source,
    clientId: d.clientId,
    projectId: d.projectId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costMicros: result.costMicros,
    status: "success",
    latencyMs,
  });
  const generationId = await saveGeneration(s, {
    usageId,
    kind: OPERATION,
    title: prepared.prompt.split("\n")[0]!.slice(0, 120),
    input: {
      designId: d.id,
      pageId: prepared.pageId,
      prompt: prepared.prompt,
      finalPrompt: prepared.finalPrompt,
      format: prepared.format,
      ratio: ratioLabel(prepared.ratio),
      style: prepared.style,
      quality: prepared.quality,
      variations: prepared.variations,
      context: prepared.context,
      size: sizeParam(prepared.size),
      files: images.map((i) => ({ fileId: i.fileId, versionId: i.versionId, width: i.width, height: i.height })),
    },
    output: `${images.length} imagem(ns) gerada(s) e salva(s) em Arquivos para a arte "${d.name}".`,
    provider: prepared.providerId,
    model: result.model,
    clientId: d.clientId,
  });
  const changed = !result.model.startsWith(prepared.model.id);
  return {
    generationId,
    provider: prepared.providerId,
    providerLabel: prepared.providerLabel,
    model: result.model,
    modelLabel: changed ? result.model : prepared.model.label,
    prompt: prepared.prompt,
    finalPrompt: prepared.finalPrompt,
    format: prepared.format,
    ratio: ratioLabel(prepared.ratio),
    contextUsed: prepared.contextUsed,
    pageId: prepared.pageId,
    images,
    warnings: prepared.warnings,
    notice: changed ? `O provedor respondeu com ${result.model} em vez de ${prepared.model.id}.` : null,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicros: result.costMicros,
      durationMs: latencyMs,
    },
  };
}

/** Registra a falha (uso com erro) — o editor não recebe nada como concluído. */
export async function recordDesignImageGenError(
  s: Scope,
  prepared: PreparedDesignImageGen,
  message: string,
  latencyMs: number,
) {
  await recordUsage(s, {
    provider: prepared.providerId,
    model: prepared.model.id,
    operation: OPERATION,
    module: MODULE,
    task: "image_generation",
    selectionSource: prepared.source,
    clientId: prepared.design.clientId,
    projectId: prepared.design.projectId,
    status: "error",
    errorMessage: message,
    latencyMs,
  });
}

/* ------------------------------------------------------------------ */
/* Melhorar a descrição com IA (modelo de texto)                       */
/* ------------------------------------------------------------------ */

export const enhanceImagePromptInput = z.object({
  designId: z.uuid(),
  prompt: z.string().trim().min(3, "Descreva a imagem.").max(IMAGE_GEN_LIMITS.prompt),
  style: z.enum(IMAGE_STYLE_KEYS).default("none"),
  context: z.enum(["none", "slide", "carousel"]).default("none"),
  document: z.record(z.string(), z.unknown()).optional(),
  pageId: z.string().max(64).optional(),
  ai: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

const ENHANCE_SYSTEM = [
  "Você é diretor de arte sênior de uma agência brasileira e escreve descrições (prompts) para modelos de geração de imagens.",
  "Melhore a descrição recebida PRESERVANDO a intenção, o assunto e os elementos pedidos pela pessoa: não troque o tema, não remova o que ela pediu nem invente marcas, textos ou pessoas reais.",
  "Acrescente, de forma concreta e curta, o que faltar: composição e enquadramento, iluminação, estilo e acabamento, materiais e atmosfera. Quando houver contexto de slide, lembre que a imagem recebe textos por cima: sem texto escrito nem logotipos.",
  "Responda em português do Brasil, em um único parágrafo de até 900 caracteres, somente com o JSON pedido.",
].join(" ");
const ENHANCE_SCHEMA = {
  type: "object",
  properties: { prompt: { type: "string" } },
  required: ["prompt"],
  additionalProperties: false,
};
const enhanceResponse = z.object({ prompt: z.string().trim().min(3).max(IMAGE_GEN_LIMITS.prompt) });

export type EnhancedImagePrompt = {
  prompt: string;
  original: string;
  demo: boolean;
  providerLabel: string;
  model: string;
  notice: string | null;
  contextUsed: boolean;
};

/**
 * Reescreve a descrição com um modelo de texto (seletor universal, tarefa
 * image_prompt). O contexto do slide/carrossel entra só quando pedido e
 * permitido pela política; a descrição original volta junto para desfazer.
 */
export async function enhanceImagePrompt(
  actor: Actor,
  raw: z.input<typeof enhanceImagePromptInput>,
): Promise<EnhancedImagePrompt> {
  const data = enhanceImagePromptInput.parse(raw);
  // Transações curtas em volta da chamada ao provedor (que roda fora de transação).
  const prepared = await inOrg(actor, async (s) => {
    const { design: d, clientName } = await loadEditable(s, data.designId);
    const prep = await prepareStructured(s, { module: MODULE, task: "image_prompt", selection: data.ai });
    if (data.context !== "none" && d.clientId && !prep.allowClientContext) throw new ValidationError(POLICY_MESSAGE);
    const doc = docFrom(data.document, d);
    const page = (data.pageId && doc.pages.find((p) => p.id === data.pageId)) || doc.pages[0]!;
    const context =
      data.context === "none"
        ? null
        : describeImageContext({
            doc,
            pageId: page.id,
            mode: data.context,
            design: { name: d.name },
            clientName: clientName ?? null,
            brand: await brandFor(s, d.clientId),
            previousPrompts: await previousPrompts(s, d.id),
          });
    return { prep, context, clientId: d.clientId };
  });
  const prompt = [
    "Formato da resposta: image_prompt",
    `Estilo escolhido: ${IMAGE_STYLES[data.style].label}`,
    "Descrição da pessoa:",
    "<<<",
    data.prompt,
    ">>>",
    prepared.context ? `Contexto:\n${prepared.context}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const call = await callStructured(actor, prepared.prep, {
    operation: "image_prompt",
    system: ENHANCE_SYSTEM,
    prompt,
    schema: ENHANCE_SCHEMA,
    parse: enhanceResponse,
    clientId: prepared.clientId,
    maxTokens: 1200,
    confirmCost: data.confirmCost,
  });
  await inOrg(actor, (s) =>
    recordStructuredSuccess(s, call, {
      title: data.prompt.split("\n")[0]!.slice(0, 120),
      input: { designId: data.designId, prompt: data.prompt, context: data.context, style: data.style },
      clientId: prepared.clientId,
    }),
  );
  return {
    prompt: call.data.prompt,
    original: data.prompt,
    demo: prepared.prep.demo,
    providerLabel: prepared.prep.providerLabel,
    model: call.model,
    notice: modelNotice(prepared.prep, call.model),
    contextUsed: !!prepared.context,
  };
}

/* ------------------------------------------------------------------ */
/* Biblioteca de imagens geradas (reutilizar sem gerar de novo)        */
/* ------------------------------------------------------------------ */

export type GeneratedLibraryItem = {
  fileId: string;
  versionId: string;
  src: string;
  name: string;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  /** Descrição usada e modelo (da nota da versão). */
  prompt: string;
  model: string | null;
  createdAt: Date;
  createdByName: string | null;
  clientName: string | null;
  projectId: string | null;
};

const NOTE_RE = /^Gerad[ao] por IA \(([^)]+)\)(?: na arte "[^"]*")?: ([\s\S]*)$/;

/**
 * Imagens geradas por IA disponíveis para a arte (do cliente dela, ou sem
 * cliente), as mais recentes primeiro — para reutilizar sem gerar de novo.
 */
export async function listGeneratedImages(s: Scope, raw: { designId: string; page?: number; pageSize?: number }) {
  assertCan(s.actor, "files.read");
  const { design: d } = await getDesign(s, raw.designId);
  const pageSize = Math.min(48, Math.max(1, raw.pageSize ?? 24));
  const page = Math.max(1, raw.page ?? 1);
  const where = and(
    fileScope(s.actor),
    isNull(files.deletedAt),
    eq(fileVersions.source, "ai"),
    like(fileVersions.mimeType, "image/%"),
    d.clientId ? eq(files.clientId, d.clientId) : isNull(files.clientId),
  );
  const rows = await s.db
    .select({
      fileId: files.id,
      name: files.name,
      projectId: files.projectId,
      clientName: clients.name,
      versionId: fileVersions.id,
      width: fileVersions.width,
      height: fileVersions.height,
      thumbnailKey: fileVersions.thumbnailKey,
      note: fileVersions.note,
      createdAt: fileVersions.createdAt,
      createdByName: user.name,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .leftJoin(clients, eq(clients.id, files.clientId))
    .leftJoin(user, eq(user.id, fileVersions.uploadedByUserId))
    .where(where)
    .orderBy(desc(fileVersions.createdAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  const items: GeneratedLibraryItem[] = rows.slice(0, pageSize).map((r) => {
    const m = r.note ? NOTE_RE.exec(r.note) : null;
    return {
      fileId: r.fileId,
      versionId: r.versionId,
      src: fileSrc(r.versionId),
      name: r.name,
      width: r.width,
      height: r.height,
      hasThumbnail: !!r.thumbnailKey,
      prompt: m ? m[2]!.trim() : (r.note ?? ""),
      model: m ? m[1]! : null,
      createdAt: r.createdAt,
      createdByName: r.createdByName,
      clientName: r.clientName,
      projectId: r.projectId,
    };
  });
  return { items, page, hasMore: rows.length > pageSize };
}
