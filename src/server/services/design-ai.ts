import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  applyOperations,
  describeObject,
  designOpSchema,
  DesignOpError,
  fileSrc,
  locate,
  readDesignDocument,
  summarizeDocument,
  versionIdOfSrc,
  type DesignDocument,
  type DesignObject,
  type DesignOp,
  type OpDiff,
} from "@/lib/design-doc";
import { PROVIDER_LABEL } from "@/lib/ai-select";
import type { AiModelInfo } from "@/lib/ai-tasks";
import { assertCan, assertInternal, can, type Scope } from "@/server/authz";
import { AiProviderError, type ImageResult } from "@/server/ai/types";
import { aiGenerations, files, user } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import {
  assertCanGenerate,
  CostConfirmationError,
  estimateMaxCostMicros,
  recordUsage,
  saveGeneration,
  type PreparedGeneration,
} from "./ai";
import { aiSelectionInput, getPickerData, ModelSelectionError, resolveSelection } from "./ai-models";
import { getBrandProfile } from "./clients";
import { getDesign, listDesigns } from "./designs";
import { getVersionForDownload, storeUpload } from "./files";
import { normalizeActions, toolsPrompt, type DesignAiAction } from "./design-ai-tools";
import { getSettings } from "./organizations";

/*
 * Chat de edição de artes por IA. O modelo não escreve no documento: ele
 * propõe OPERAÇÕES (lib/design-doc/ops), que o servidor valida e simula
 * (prévia com antes/depois). A pessoa aceita e a alteração é aplicada pelo
 * caminho normal — no editor, pelo histórico de desfazer e o salvamento
 * automático; fora dele, por applyDesignOperations com versão anterior
 * preservada. Imagens são editadas por um provedor real que aceite a imagem
 * original como referência; o resultado vira um arquivo novo em Arquivos e
 * entra na arte com replaceImage (nada é achatado; o original continua lá).
 */

export const POLICY_MESSAGE =
  "A política de IA da organização não permite enviar dados de clientes ao provedor. Um administrador pode liberar em Configurações → Inteligência artificial (“Enviar contexto dos clientes ao provedor”).";

/** Operações que o chat pode propor (sem mexer em componentes, metadados ou estrutura de páginas). */
export const DESIGN_AI_OPS = [
  "setText",
  "setStyle",
  "transform",
  "move",
  "resize",
  "remove",
  "changePalette",
  "updatePage",
  "reorder",
  "align",
  "distribute",
  "imageFit",
  "duplicate",
] as const;
const ALLOWED = new Set<string>(DESIGN_AI_OPS);

const SYSTEM_BASE = `Você edita artes de uma agência de marketing brasileira dentro de um editor com camadas.
Você NÃO desenha nem devolve imagens: você propõe operações sobre o documento (e, quando preciso, ações de ferramentas), que a pessoa revisa antes de aplicar.
Responda SOMENTE com JSON válido, sem texto fora do JSON, no formato:
{"reply": string, "ops": string, "actions": string, "question": string}
- "reply": resumo curto, em português, do que vai mudar.
- "ops": texto JSON com a LISTA de operações (ex.: "[{\\"op\\":\\"setText\\",\\"id\\":\\"t1\\",\\"text\\":\\"Novo título\\"}]"); "[]" quando não houver.
- "actions": texto JSON com a LISTA de ações de ferramentas (ex.: "[{\\"tool\\":\\"image_edit\\",\\"args\\":{\\"targetId\\":\\"i1\\",\\"instruction\\":\\"mais iluminada\\"}}]"); "[]" quando não houver.
- "question": quando faltar informação (ex.: qual elemento), pergunte aqui e devolva ops e actions "[]"; senão "".
Regras:
- Altere SOMENTE o que foi pedido. Não reescreva outros textos, não mude fontes, cores ou posições sem pedido.
- Preserve a formatação: setText troca apenas o texto (fonte, cor, alinhamento e posição continuam).
- Respeite o espaço do layout: o texto novo deve ter tamanho parecido com o atual; se for maior, reduza o fontSize na mesma resposta.
- Use somente ids que aparecem no contexto. "Página ativa" e "selecionados" dizem onde a pessoa está.
- Nunca remova elementos sem pedido explícito. Nunca invente o endereço (src) de imagens.
- No carrossel, preserve a ordem das páginas; edite só a página pedida.
Operações aceitas:
{"op":"setText","id":ID,"text":TEXTO}
{"op":"setStyle","ids":[ID],"style":{"fontSize":N,"fontWeight":N,"fontFamily":TEXTO,"color":"#hex","fill":"#hex","textAlign":"left|center|right","lineHeight":N,"letterSpacing":N,"opacity":0-1}} (inclua só as propriedades que mudam)
{"op":"transform","id":ID,"x":N,"y":N,"width":N,"height":N,"rotation":N} (só os campos que mudam)
{"op":"move","ids":[ID],"dx":N,"dy":N}
{"op":"resize","ids":[ID],"scaleX":N,"scaleY":N}
{"op":"remove","ids":[ID]}
{"op":"changePalette","map":[{"from":"#hex","to":"#hex"}],"pageId":ID_DA_PAGINA}
{"op":"updatePage","id":ID_DA_PAGINA,"set":{"background":"#hex"}}
{"op":"reorder","id":ID,"to":"front|back|forward|backward"}
{"op":"align","ids":[ID],"edge":"left|hcenter|right|top|vcenter|bottom","to":"page"}
{"op":"imageFit","id":ID,"mode":"fill|fit"}`;

/** Prompt do sistema com as ferramentas registradas no momento. */
function systemPrompt() {
  const tools = toolsPrompt();
  return tools ? `${SYSTEM_BASE}\n${tools}` : SYSTEM_BASE;
}

const STR = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const SCHEMA = obj({ reply: STR, ops: STR, actions: STR, question: STR });

const historyTurn = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) });

export const designAiRequest = z.object({
  designId: z.uuid(),
  message: z.string().trim().min(2, "Escreva o que deseja mudar.").max(2000),
  history: z.array(historyTurn).max(12).default([]),
  /** Estado atual do editor (pode ter alterações ainda não salvas): base do contexto e da prévia. */
  document: z.record(z.string(), z.unknown()).optional(),
  pageId: z.string().max(64).optional(),
  selection: z.array(z.string().max(64)).max(50).default([]),
  ai: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

export type DesignAiCtx = {
  designId: string;
  doc: DesignDocument;
  revision: number;
  clientId: string | null;
};

export type PreparedDesignAi = { generation: PreparedGeneration; input: Record<string, string>; ctx: DesignAiCtx };

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

/** `document.meta.generator` (gerador de carrosséis), resumido para caber no contexto. */
function generatorPlan(...docs: unknown[]): unknown {
  for (const raw of docs) {
    const meta = raw && typeof raw === "object" ? (raw as { meta?: unknown }).meta : null;
    const plan = meta && typeof meta === "object" ? (meta as { generator?: unknown }).generator : null;
    if (!plan || typeof plan !== "object") continue;
    const json = JSON.stringify(plan, (_k, v: unknown) =>
      typeof v === "string" && v.length > 600 ? `${v.slice(0, 600)}…` : v,
    );
    return json.length > 6000 ? { resumo: `${json.slice(0, 6000)}…` } : (JSON.parse(json) as unknown);
  }
  return null;
}

/** Textos muito longos entram encurtados no contexto (a operação usa sempre o texto completo da pessoa). */
function trimSummary(summary: ReturnType<typeof summarizeDocument>) {
  const walk = (o: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...o };
    if (typeof out.text === "string" && out.text.length > 1200) out.text = `${out.text.slice(0, 1200)}…`;
    if (typeof out.src === "string" && out.src.startsWith("data:")) out.src = "(imagem embutida)";
    if (Array.isArray(out.children)) out.children = (out.children as Record<string, unknown>[]).map(walk);
    return out;
  };
  return { ...summary, pages: summary.pages.map((p) => ({ ...p, objects: p.objects.map(walk) })) };
}

/**
 * Valida o pedido, aplica permissões e a política de IA, resolve o modelo de
 * texto (seletor universal, módulo "editor") e monta o contexto com a arte, a
 * página ativa, a seleção e a identidade do cliente — só desta arte.
 */
export async function prepareDesignAi(s: Scope, raw: z.input<typeof designAiRequest>): Promise<PreparedDesignAi> {
  const data = designAiRequest.parse(raw);
  const { design: d, clientName } = await loadEditable(s, data.designId);
  const settings = await assertCanGenerate(s);
  const resolved = await resolveSelection(s, { module: "editor", task: "design_edit", selection: data.ai });
  const demo = resolved.def.id === "demo";
  if (d.clientId && !demo && !settings.allowClientContext) throw new ValidationError(POLICY_MESSAGE);

  const doc = docFrom(data.document, d);
  const pageIndex = Math.max(0, data.pageId ? doc.pages.findIndex((p) => p.id === data.pageId) : 0);
  const selection = data.selection.filter((id) => locate(doc, id));
  let brand: { colors: string[]; fonts: string[] } | null = null;
  if (d.clientId && can(s.actor, "clients.read")) {
    const b = await getBrandProfile(s, d.clientId).catch(() => null);
    if (b) brand = { colors: b.colors.map((c) => c.hex), fonts: b.fonts.map((f) => f.name) };
  }
  const generator = generatorPlan(data.document, d.document);
  const context = {
    design: { name: d.name, cliente: clientName ?? null },
    activePage: pageIndex + 1,
    selection,
    selectionNames: selection.map((id) => describeObject(locate(doc, id)!.object)),
    brand,
    // Plano do gerador de carrosséis (roteiro e direção de arte), quando a arte veio dele.
    ...(generator ? { generator } : {}),
    document: trimSummary(summarizeDocument(doc)),
  };
  const contextJson = JSON.stringify(context);
  if (contextJson.length > 60_000) {
    throw new ValidationError("A arte é grande demais para o chat de IA. Selecione uma página com menos elementos.");
  }
  const history = data.history
    .slice(-8)
    .map((h) => `${h.role === "user" ? "Pessoa" : "Assistente"}: ${h.text.replace(/\s+/g, " ").slice(0, 600)}`);
  const prompt = [
    "Tarefa: editar_arte",
    `Pedido: ${data.message.replace(/\s+/g, " ")}`,
    "Contexto (JSON):",
    contextJson,
    history.length ? `Conversa anterior (mais antiga primeiro):\n${history.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const maxTokens = Math.min(4000, resolved.model.maxOutputTokens ?? Infinity);
  const system = systemPrompt();
  const estimateMicros = estimateMaxCostMicros(resolved.model, system.length + prompt.length, maxTokens);
  if (
    settings.confirmAboveMicros > 0 &&
    estimateMicros !== null &&
    estimateMicros > settings.confirmAboveMicros &&
    !data.confirmCost
  ) {
    throw new CostConfirmationError(estimateMicros);
  }

  return {
    ctx: { designId: d.id, doc, revision: d.revision, clientId: d.clientId },
    input: { text: data.message, message: data.message, designId: d.id },
    generation: {
      operation: "design_edit",
      label: "Editar arte",
      structured: true,
      jsonSchema: SCHEMA,
      system,
      prompt,
      maxTokens,
      model: resolved.model,
      provider: resolved.def.text!(resolved.apiKey ?? "", { baseUrl: resolved.baseUrl }),
      providerId: resolved.def.id,
      providerLabel: resolved.def.label,
      demo,
      module: "editor",
      task: "design_edit",
      source: resolved.source,
      keySource: resolved.keySource,
      reason: resolved.reason,
      warnings: resolved.warnings,
      clientId: d.clientId,
      projectId: d.projectId,
      contextUsed: true,
      estimateMicros,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Proposta (nada é gravado aqui)                                      */
/* ------------------------------------------------------------------ */

export type DesignAiChange = { label: string; field: string; before: unknown; after: unknown };

export type DesignAiProposal = {
  reply: string;
  question: string | null;
  ops: DesignOp[];
  inverse: DesignOp[];
  summary: string[];
  changes: DesignAiChange[];
  /** Páginas afetadas (número, 1 = primeira). */
  pages: number[];
  /** Operações descartadas por serem inválidas ou não permitidas. */
  skipped: number;
  /** Elementos que seriam removidos (a interface pede confirmação explícita). */
  removes: number;
  /**
   * Ações de ferramentas do registro (design-ai-tools), executadas em outra
   * etapa — ex.: image_edit gera a nova imagem com um modelo de imagem.
   */
  actions: DesignAiAction[];
};

function parseOps(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const FIELD_LABEL: Record<string, string> = {
  text: "Texto",
  fontSize: "Tamanho da fonte",
  fontWeight: "Peso da fonte",
  fontFamily: "Fonte",
  color: "Cor do texto",
  fill: "Preenchimento",
  textAlign: "Alinhamento",
  opacity: "Opacidade",
  x: "Posição X",
  y: "Posição Y",
  width: "Largura",
  height: "Altura",
  rotation: "Rotação",
  src: "Imagem",
  background: "Fundo da página",
};

function changesOf(diffs: OpDiff[]): DesignAiChange[] {
  const out: DesignAiChange[] = [];
  for (const d of diffs) {
    const label = d.targets[0]?.label ?? d.summary;
    for (const c of d.changes.slice(0, 30)) {
      if (typeof c.before === "object" && c.before !== null && c.field !== "fill" && c.field !== "color") continue;
      out.push({ label, field: FIELD_LABEL[c.field] ?? c.field, before: c.before, after: c.after });
    }
  }
  return out.slice(0, 60);
}

function pagesOf(doc: DesignDocument, diffs: OpDiff[]) {
  const set = new Set<number>();
  for (const d of diffs) {
    for (const t of d.targets) {
      const pageId = t.kind === "page" ? t.id : (t.pageId ?? (t.kind === "object" ? locate(doc, t.id)?.pageId : null));
      const n = pageId ? doc.pages.findIndex((p) => p.id === pageId) : -1;
      if (n >= 0) set.add(n + 1);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Valida e simula as operações propostas pelo modelo sobre a arte atual:
 * descarta o que for inválido, fora da lista permitida ou referente a
 * elementos inexistentes, e devolve a prévia (antes/depois) e o desfazer.
 */
export function normalizeDesignAi(ctx: Pick<DesignAiCtx, "doc">, data: unknown): DesignAiProposal {
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const reply = typeof r.reply === "string" && r.reply.trim() ? r.reply.trim().slice(0, 2000) : "Pronto.";
  const question = typeof r.question === "string" && r.question.trim() ? r.question.trim().slice(0, 600) : null;
  const rawOps = parseOps(r.ops).slice(0, 60);
  let skipped = 0;
  const kept: DesignOp[] = [];
  let probe = ctx.doc;
  for (const raw of rawOps) {
    const parsed = designOpSchema.safeParse(raw);
    if (!parsed.success || !ALLOWED.has(parsed.data.op)) {
      skipped++;
      continue;
    }
    try {
      probe = applyOperations(probe, [parsed.data]).doc;
      kept.push(parsed.data);
    } catch (err) {
      if (!(err instanceof DesignOpError)) throw err;
      skipped++;
    }
  }
  let ops: DesignOp[] = [];
  let inverse: DesignOp[] = [];
  let diffs: OpDiff[] = [];
  if (kept.length) {
    const res = applyOperations(ctx.doc, kept);
    ops = res.applied;
    inverse = res.inverse;
    diffs = res.diffs;
  }

  // Formato antigo ({"image": {targetId, instruction}}) ainda aceito como a ferramenta image_edit.
  const legacy =
    r.image && typeof r.image === "object" && (r.image as { targetId?: unknown }).targetId
      ? [{ tool: "image_edit", args: r.image }]
      : [];
  const listed = normalizeActions(ctx, r.actions);
  const actions = [...listed.actions, ...normalizeActions(ctx, legacy).actions];
  skipped += listed.skipped;
  return {
    reply,
    question,
    ops,
    inverse,
    summary: diffs.map((d) => d.summary),
    changes: changesOf(diffs),
    pages: pagesOf(ctx.doc, diffs),
    skipped,
    removes: ops.reduce((n, o) => n + (o.op === "remove" ? o.ids.length : 0), 0),
    actions,
  };
}

/* ------------------------------------------------------------------ */
/* Edição de imagem (provedor real com a original como referência)      */
/* ------------------------------------------------------------------ */

export const designImageEditRequest = z.object({
  designId: z.uuid(),
  objectId: z.string().min(1).max(64),
  instruction: z.string().trim().min(3, "Descreva a alteração da imagem.").max(2000),
  document: z.record(z.string(), z.unknown()).optional(),
  ai: aiSelectionInput.optional(),
  /** "generate" = gerar uma imagem nova a partir da descrição (sem usar a original), por escolha explícita. */
  mode: z.enum(["edit", "generate"]).default("edit"),
  confirmCost: z.boolean().optional(),
});

function sizeFor(w: number, h: number) {
  if (w > h * 1.2) return "1536x1024";
  if (h > w * 1.2) return "1024x1536";
  return "1024x1024";
}

export type PreparedDesignImage = {
  mode: "edit" | "generate";
  instruction: string;
  design: { id: string; name: string; clientId: string | null; projectId: string | null };
  doc: DesignDocument;
  objectId: string;
  originalVersionId: string;
  demo: boolean;
  providerId: string;
  providerLabel: string;
  model: AiModelInfo;
  source: string;
  keySource: string | null;
  task: "image_edit" | "image_generation";
  run: (signal?: AbortSignal) => Promise<ImageResult>;
};

/**
 * Valida o pedido de nova versão de uma imagem da arte. No modo "edit" a
 * imagem original (da Central de Arquivos, do mesmo cliente) vai como
 * referência a um modelo que edita imagens; se o modelo escolhido não edita,
 * o erro explica e a pessoa pode optar, explicitamente, por gerar uma imagem
 * nova só a partir da descrição.
 */
export async function prepareDesignImage(
  s: Scope,
  raw: z.input<typeof designImageEditRequest>,
): Promise<PreparedDesignImage> {
  const data = designImageEditRequest.parse(raw);
  const { design: d } = await loadEditable(s, data.designId);
  if (!can(s.actor, "files.write")) {
    throw new ForbiddenError("Você não tem permissão para salvar a nova imagem em Arquivos.");
  }
  const doc = docFrom(data.document, d);
  const loc = locate(doc, data.objectId);
  if (!loc || loc.object.type !== "image") throw new NotFoundError("Imagem não encontrada nesta arte.");
  const target = loc.object;
  const originalVersionId = versionIdOfSrc(target.src);
  if (!originalVersionId) {
    throw new ValidationError(
      "Esta imagem está embutida na arte (não está em Arquivos). Envie-a para Arquivos e use-a na arte para editá-la com IA.",
    );
  }
  const version = await getVersionForDownload(s, originalVersionId);
  const [owner] = await s.db.select({ clientId: files.clientId }).from(files).where(eq(files.id, version.fileId));
  if (d.clientId && owner?.clientId && owner.clientId !== d.clientId) {
    throw new ValidationError("A imagem pertence a outro cliente.");
  }

  const settings = await assertCanGenerate(s);
  const task = data.mode === "edit" ? "image_edit" : "image_generation";
  const resolved = await resolveSelection(s, { module: "editor", task, selection: data.ai });
  const def = resolved.def;
  const demo = def.id === "demo";
  const providerLabel = PROVIDER_LABEL[def.id] ?? def.label;
  if (data.mode === "edit" && d.clientId && !demo && !settings.allowClientContext) {
    throw new ValidationError(POLICY_MESSAGE);
  }
  if (data.mode === "edit" && !def.imageEdit) {
    throw new ModelSelectionError(
      `${providerLabel} não edita imagens usando a original como referência nesta versão. Escolha um modelo de edição de imagem (OpenAI gpt-image) ou gere uma imagem nova a partir da descrição.`,
      "model_incompatible",
    );
  }
  if (data.mode === "generate" && !def.image) {
    throw new ModelSelectionError(`${providerLabel} não gera imagens nesta versão.`, "model_incompatible");
  }
  // A Images API não informa preço: com aviso de custo configurado, pedimos confirmação.
  if (!demo && settings.confirmAboveMicros > 0 && !data.confirmCost) throw new CostConfirmationError(null);

  const apiKey = resolved.apiKey ?? "";
  const size = sizeFor(target.naturalWidth ?? target.width, target.naturalHeight ?? target.height);
  const edit = def.imageEdit;
  const generate = def.image;
  const storageKey = version.storageKey;
  const mimeType = version.mimeType || "image/png";
  return {
    mode: data.mode,
    instruction: data.instruction,
    design: { id: d.id, name: d.name, clientId: d.clientId, projectId: d.projectId },
    doc,
    objectId: target.id,
    originalVersionId,
    demo,
    providerId: def.id,
    providerLabel,
    model: resolved.model,
    source: resolved.source,
    keySource: resolved.keySource,
    task,
    run: async (signal) => {
      const baseUrl = resolved.baseUrl;
      if (data.mode === "edit") {
        const image = await getStorage().get(storageKey);
        return edit!(apiKey, {
          model: resolved.model.id,
          baseUrl,
          prompt: data.instruction,
          image,
          mimeType,
          size,
          signal,
        });
      }
      return generate!(apiKey, { model: resolved.model.id, baseUrl, prompt: data.instruction, size, signal });
    },
  };
}

export type DesignImageEditResult = {
  fileId: string;
  versionId: string;
  src: string;
  width: number;
  height: number;
  mode: "edit" | "generate";
  demo: boolean;
  providerLabel: string;
  modelLabel: string;
  originalVersionId: string;
  generationId: string;
  /** Operação pronta para aplicar (troca só esta imagem; o resto da arte continua igual). */
  op: DesignOp;
  inverse: DesignOp[];
  summary: string[];
};

/**
 * Salva a nova imagem como arquivo NOVO em Arquivos (mesmo cliente/projeto da
 * arte — a original não é tocada), registra uso e histórico e devolve a
 * operação replaceImage para a prévia. Nada muda na arte até a pessoa aplicar.
 */
export async function saveDesignImage(
  s: Scope,
  prepared: PreparedDesignImage,
  result: ImageResult,
  latencyMs: number,
): Promise<DesignImageEditResult> {
  const png = result.images[0];
  if (!png) throw new AiProviderError("O provedor não devolveu imagem. Tente novamente.", "unavailable");
  const meta = await sharp(png).metadata();
  const { design: d } = prepared;
  const usageId = await recordUsage(s, {
    provider: prepared.providerId,
    model: result.model,
    operation: "image_edit",
    module: "editor",
    task: prepared.task,
    selectionSource: prepared.source,
    keySource: prepared.keySource,
    clientId: d.clientId,
    projectId: d.projectId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costMicros: result.costMicros,
    status: "success",
    latencyMs,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const edited = prepared.mode === "edit";
  const stored = await storeUpload(
    s,
    { buffer: png, originalName: `ia-${edited ? "edicao" : "imagem"}-${stamp}.png` },
    {
      clientId: d.clientId,
      projectId: d.projectId,
      category: "general",
      tags: ["ia"],
      note: `${edited ? "Edição por IA a partir da imagem original" : "Imagem nova por IA"} (${result.model}) para a arte "${d.name}": ${prepared.instruction}`.slice(
        0,
        500,
      ),
      source: "ai",
    },
  );
  const generationId = await saveGeneration(s, {
    usageId,
    kind: "image_edit",
    title: prepared.instruction.split("\n")[0]!.slice(0, 120),
    input: {
      designId: d.id,
      objectId: prepared.objectId,
      message: prepared.instruction,
      original: prepared.originalVersionId,
      result: stored.versionId,
      mode: prepared.mode,
    },
    output: `Nova versão da imagem salva em Arquivos${edited ? " (a original continua lá)" : ""}.`,
    provider: prepared.providerId,
    model: result.model,
    clientId: d.clientId,
  });
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;
  const res = applyOperations(prepared.doc, [
    {
      op: "replaceImage",
      id: prepared.objectId,
      src: fileSrc(stored.versionId),
      naturalWidth: width,
      naturalHeight: height,
      fit: "fill",
    },
  ]);
  return {
    fileId: stored.fileId,
    versionId: stored.versionId,
    src: fileSrc(stored.versionId),
    width,
    height,
    mode: prepared.mode,
    demo: prepared.demo,
    providerLabel: prepared.providerLabel,
    modelLabel: prepared.model.label,
    originalVersionId: prepared.originalVersionId,
    generationId,
    op: res.applied[0]!,
    inverse: res.inverse,
    summary: res.diffs.map((x) => x.summary),
  };
}

/** Registra o desfecho da proposta no histórico (aplicada, cancelada ou desfeita). */
export const designAiOutcomeInput = z.object({
  generationId: z.uuid(),
  outcome: z.enum(["applied", "cancelled", "undone"]),
});

export async function setDesignAiOutcome(s: Scope, raw: z.input<typeof designAiOutcomeInput>) {
  const data = designAiOutcomeInput.parse(raw);
  const [g] = await s.db
    .select({ id: aiGenerations.id, userId: aiGenerations.userId, kind: aiGenerations.kind })
    .from(aiGenerations)
    .where(eq(aiGenerations.id, data.generationId));
  if (!g || (g.kind !== "design_edit" && g.kind !== "image_edit")) throw new NotFoundError("Pedido não encontrado.");
  if (g.userId !== s.actor.userId) throw new ForbiddenError();
  await s.db
    .update(aiGenerations)
    .set({
      input: sql`${aiGenerations.input} || ${JSON.stringify({ outcome: data.outcome, outcomeAt: new Date().toISOString() })}::jsonb`,
    })
    .where(eq(aiGenerations.id, data.generationId));
}

/* ------------------------------------------------------------------ */
/* Histórico da conversa desta arte                                    */
/* ------------------------------------------------------------------ */

export type DesignAiHistoryItem = {
  id: string;
  kind: "design_edit" | "image_edit";
  message: string;
  reply: string;
  createdAt: Date;
  userName: string | null;
  outcome: "applied" | "cancelled" | "undone" | null;
};

/** Pedidos anteriores feitos ao chat sobre esta arte (quem pode abrir a arte vê). */
export async function listDesignAiHistory(s: Scope, designId: string, limit = 30): Promise<DesignAiHistoryItem[]> {
  await getDesign(s, designId);
  const rows = await s.db
    .select({
      id: aiGenerations.id,
      kind: aiGenerations.kind,
      input: aiGenerations.input,
      output: aiGenerations.output,
      createdAt: aiGenerations.createdAt,
      userName: user.name,
    })
    .from(aiGenerations)
    .leftJoin(user, eq(user.id, aiGenerations.userId))
    .where(
      and(
        inArray(aiGenerations.kind, ["design_edit", "image_edit"]),
        sql`${aiGenerations.input}->>'designId' = ${designId}`,
      ),
    )
    .orderBy(desc(aiGenerations.createdAt))
    .limit(Math.min(limit, 100));
  return rows.reverse().map((r) => {
    let reply = r.output;
    if (r.kind === "design_edit") {
      try {
        const parsed = JSON.parse(r.output) as { reply?: unknown; question?: unknown };
        reply = [parsed.reply, parsed.question].filter((x) => typeof x === "string" && x).join(" ");
      } catch {
        reply = r.output.slice(0, 600);
      }
    }
    return {
      id: r.id,
      kind: r.kind as DesignAiHistoryItem["kind"],
      message: String((r.input as Record<string, unknown>).message ?? ""),
      reply: reply.slice(0, 1200),
      createdAt: r.createdAt,
      userName: r.userName,
      outcome: ((r.input as Record<string, unknown>).outcome as DesignAiHistoryItem["outcome"]) ?? null,
    };
  });
}

/** Objeto da arte pelo id (para a interface mostrar o rótulo). */
export function objectLabel(doc: DesignDocument, id: string): string | null {
  const loc = locate(doc, id);
  return loc ? describeObject(loc.object as DesignObject) : null;
}

/* ------------------------------------------------------------------ */
/* Dados do painel (carregados só quando ele abre)                     */
/* ------------------------------------------------------------------ */

export async function designAiSetup(s: Scope, designId: string) {
  assertInternal(s.actor);
  const { design: d } = await getDesign(s, designId);
  if (!can(s.actor, "ai.use")) return { canUse: false as const };
  const settings = (await getSettings(s)).ai;
  // Valida credenciais pendentes antes de listar: só aparecem modelos realmente disponíveis.
  const picker = await getPickerData(s, { refresh: settings.enabled });
  const ready = picker.providers.filter((p) => p.ready);
  return {
    canUse: true as const,
    canEdit: can(s.actor, "designs.write") && (!d.isTemplate || can(s.actor, "templates.manage")),
    canSaveFiles: can(s.actor, "files.write"),
    enabled: settings.enabled,
    configured: ready.length > 0,
    demo: ready.length > 0 && ready.every((p) => p.id === "demo"),
    allowClientContext: settings.allowClientContext,
    hasClient: !!d.clientId,
    revision: d.revision,
    picker,
    history: await listDesignAiHistory(s, designId),
  };
}
export type DesignAiSetup = Awaited<ReturnType<typeof designAiSetup>>;

/** Artes que a pessoa pode editar pelo chat no Assistente IA (as mais recentes). */
export async function designAiTargets(s: Scope) {
  assertInternal(s.actor);
  if (!can(s.actor, "designs.read")) return [];
  const rows = await listDesigns(s, {});
  return rows.slice(0, 60).map((r) => ({
    id: r.id,
    name: r.name,
    thumbnail: r.thumbnail,
    clientName: r.clientName,
    projectName: r.projectName,
    pageCount: Number(r.pageCount) || 1,
    updatedAt: r.updatedAt,
  }));
}
export type DesignAiTarget = Awaited<ReturnType<typeof designAiTargets>>[number];
