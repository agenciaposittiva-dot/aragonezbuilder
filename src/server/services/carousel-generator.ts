import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  assembleDocument,
  assignLayouts,
  currentSlides,
  FORMAT_SIZE,
  renderGeneratedPage,
} from "@/lib/carousel-gen/assemble";
import { buildDirection, hashSeed, STYLES, PALETTES, type BrandIdentity } from "@/lib/carousel-gen/direction";
import { normalizeHex } from "@/lib/carousel-gen/color";
import {
  aiPlanSchema,
  normalizePlan,
  normalizeSlide,
  numbersIn,
  PLAN_JSON_SCHEMA,
  SLIDE_JSON_SCHEMA,
  slideResponseSchema,
} from "@/lib/carousel-gen/plan";
import {
  MOTIFS,
  newId,
  readDesignDocument,
  SLIDE_ROLE_LABEL,
  type DesignOp,
  type GeneratorMeta,
  type GeneratorSlide,
} from "@/lib/design-doc";
import {
  assertCan,
  assertClientAccess,
  assertInternal,
  can,
  fileScope,
  inOrg,
  type Actor,
  type Scope,
} from "@/server/authz";
import { brandProfiles, clients, files, fileVersions } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { prepareImage, type PreparedImage } from "./ai-images";
import { aiSelectionInput, ModelSelectionError } from "./ai-models";
import { runImage } from "./ai-run";
import {
  assertCostConfirmed,
  callStructured,
  modelNotice,
  prepareStructured,
  recordStructuredSuccess,
  type PreparedStructured,
} from "./ai-structured";
import { applyDesignOperations, createDesign, getDesign } from "./designs";

/*
 * Gerador automático de carrosséis. Fluxo (com progresso real transmitido):
 *   1. Planejando conteúdo  — a IA escolhida no seletor universal define
 *      estratégia, narrativa e roteiro (JSON validado);
 *   2. Criando roteiro      — regras aplicadas à resposta: quantidade de
 *      slides, limites de texto, nenhum número que não esteja nas referências
 *      (vira "dado a confirmar");
 *   3. Preparando recursos visuais — imagens dos Arquivos escolhidas pela
 *      equipe e imagens geradas pelo modelo de imagem (salvas em Arquivos do
 *      cliente); sem modelo de imagem, só vetores (nunca imagem falsa);
 *   4. Montando slides      — direção de arte (identidade do cliente ou
 *      sugestão revisável) e composição de cada slide;
 *   5. Salvando projeto     — arte nova no formato do editor (nuvem central).
 *
 * Depois: regenerar um slide, trocar a direção visual mantendo os textos e
 * criar uma segunda versão com outra composição — todos pelo mesmo plano
 * guardado em meta.generator (veja docs/CARROSSEL-GERADOR.md).
 */

const MODULE = "carousel";

export const carouselGenerateInput = z.object({
  mode: z.enum(["quick", "full"]).default("quick"),
  topic: z.string().trim().min(3, "Descreva o assunto do carrossel.").max(300),
  clientId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  name: z.string().trim().max(120).optional(),
  objective: z.string().trim().max(500).optional(),
  audience: z.string().trim().max(500).optional(),
  tone: z.string().trim().max(160).optional(),
  references: z.string().trim().max(2000).optional(),
  slides: z.number().int().min(3).max(10).nullable().optional(),
  format: z.enum(["portrait", "square"]).default("portrait"),
  useIdentity: z.boolean().default(true),
  fileIds: z.array(z.uuid()).max(6).default([]),
  images: z.enum(["auto", "none"]).default("auto"),
  /** Limite de imagens geradas por IA (custo). */
  maxImages: z.number().int().min(0).max(4).default(2),
  selection: aiSelectionInput.optional(),
  imageSelection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
  /** Variação extra da semente (testes e "gerar de novo"). */
  nonce: z.string().max(40).optional(),
});
export type CarouselGenerateInput = z.input<typeof carouselGenerateInput>;

export const CAROUSEL_STEPS = [
  { key: "plan", label: "Planejando conteúdo" },
  { key: "script", label: "Criando roteiro" },
  { key: "visuals", label: "Preparando recursos visuais" },
  { key: "assemble", label: "Montando slides" },
  { key: "save", label: "Salvando projeto" },
] as const;
export type CarouselStep = (typeof CAROUSEL_STEPS)[number]["key"];

export type CarouselEvent =
  | {
      t: "meta";
      demo: boolean;
      provider: string;
      providerLabel: string;
      model: string;
      modelLabel: string;
      reason: string;
      imageProvider: string | null;
      imageModel: string | null;
      warnings: string[];
    }
  | { t: "step"; step: CarouselStep; status: "running" | "done" | "skipped"; detail?: string }
  | {
      t: "done";
      designId: string;
      name: string;
      slides: number;
      claims: GeneratorMeta["claims"];
      warnings: string[];
      visuals: GeneratorMeta["visuals"];
      demo: boolean;
      notice: string | null;
    }
  | { t: "error"; message: string; kind: string; retryable: boolean };

const SYSTEM = [
  "Você é estrategista de conteúdo e diretor de arte sênior de uma agência brasileira, especialista em carrosséis para Instagram e LinkedIn.",
  "Antes de escrever, defina objetivo, público, ângulo e narrativa. Cada slide tem UMA ideia, com continuidade clara entre eles: gancho forte na capa, desenvolvimento e chamada para ação no final.",
  "Textos curtos e escaneáveis: título até 70 caracteres, texto até 220, itens de lista até 90.",
  "NUNCA invente dados: números, porcentagens, estatísticas, pesquisas, preços, prêmios, depoimentos ou citações de pessoas reais só podem aparecer se estiverem nas referências enviadas pela equipe. Na dúvida, escreva sem números. Liste em `claims` toda afirmação que precise de fonte.",
  "Para slides com imagem, escreva em `visual.prompt` uma descrição de foto/ilustração SEM texto escrito, sem logotipos e sem pessoas reais identificáveis. Use `visual.kind` = icon/diagram/typographic quando a imagem não for necessária.",
  "Respeite a identidade e as restrições da marca quando forem enviadas. Responda em português do Brasil, somente com o JSON pedido.",
].join(" ");

/* ------------------------------------------------------------------ */
/* Identidade e arquivos                                               */
/* ------------------------------------------------------------------ */

type ClientInfo = {
  identity: BrandIdentity;
  /** Contexto de marca para o prompt (só com autorização da organização). */
  context: string;
};

async function fileImage(s: Scope, fileId: string, clientId: string | null) {
  const [row] = await s.db
    .select({
      fileId: files.id,
      clientId: files.clientId,
      versionId: fileVersions.id,
      mime: fileVersions.mimeType,
      width: fileVersions.width,
      height: fileVersions.height,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(and(eq(files.id, fileId), fileScope(s.actor), isNull(files.deletedAt)))
    .limit(1);
  if (!row) return null;
  if (!/^image\/(png|jpeg|webp)$/.test(row.mime) || !row.width || !row.height) return null;
  if (clientId && row.clientId && row.clientId !== clientId) return null;
  return { fileId: row.fileId, versionId: row.versionId, width: row.width, height: row.height };
}

async function loadClient(s: Scope, clientId: string, withContext: boolean): Promise<ClientInfo> {
  await assertClientAccess(s, clientId);
  const [row] = await s.db
    .select({ client: clients, brand: brandProfiles })
    .from(clients)
    .leftJoin(brandProfiles, eq(brandProfiles.clientId, clients.id))
    .where(eq(clients.id, clientId));
  if (!row) throw new NotFoundError("Cliente não encontrado.");
  const b = row.brand;
  // Logo do CLIENTE (nunca a da agência).
  const logo = row.client.logoFileId ? await fileImage(s, row.client.logoFileId, clientId) : null;
  const colors = (b?.colors ?? []).map((c) => normalizeHex(c.hex)).filter((c): c is string => !!c);
  const fonts = (b?.fonts ?? []).map((f) => f.name.trim()).filter(Boolean);
  const context = withContext
    ? [
        `Marca: ${row.client.name}`,
        row.client.industry ? `Segmento: ${row.client.industry}` : null,
        b?.audience ? `Público-alvo da marca: ${b.audience}` : null,
        b?.toneOfVoice ? `Tom de voz: ${b.toneOfVoice}` : null,
        b?.positioning ? `Posicionamento: ${b.positioning}` : null,
        b?.objectives ? `Objetivos da marca: ${b.objectives}` : null,
        b?.keywords?.length ? `Palavras-chave: ${b.keywords.join(", ")}` : null,
        b?.avoid ? `Evitar: ${b.avoid}` : null,
        b?.guidelines ? `Diretrizes: ${b.guidelines.slice(0, 800)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  return {
    identity: {
      name: row.client.name,
      colors,
      fonts,
      handle: row.client.name,
      logo: logo ? { fileId: logo.fileId, versionId: logo.versionId, width: logo.width, height: logo.height } : null,
    },
    context,
  };
}

/* ------------------------------------------------------------------ */
/* Preparação (permissões, modelos e custo) — antes de transmitir      */
/* ------------------------------------------------------------------ */

export type PreparedCarousel = {
  data: z.output<typeof carouselGenerateInput>;
  text: PreparedStructured;
  image: PreparedImage | null;
  imageWarning: string | null;
  client: ClientInfo | null;
  userImages: { fileId: string; versionId: string; width: number; height: number }[];
  system: string;
  prompt: string;
  maxTokens: number;
};

function planPrompt(
  data: z.output<typeof carouselGenerateInput>,
  brand: string,
  contextAllowed: boolean,
  hasClient: boolean,
) {
  return [
    "Formato da resposta: carousel_plan",
    `Tema: ${data.topic}`,
    data.objective
      ? `Objetivo: ${data.objective}`
      : "Objetivo não informado: defina o mais adequado ao tema (educar, engajar ou converter).",
    data.audience ? `Público: ${data.audience}` : null,
    data.tone ? `Tom: ${data.tone}` : null,
    `Quantidade de slides: ${data.slides ?? "automática (entre 5 e 8)"}`,
    `Formato: ${data.format === "portrait" ? "retrato 1080 × 1350" : "quadrado 1080 × 1080"}`,
    `Papéis possíveis dos slides: cover (capa), problem, context, insight, data (só com número das referências), list, steps, comparison (duas colunas), quote (só citação real enviada), summary, cta (final).`,
    data.images === "none"
      ? "Não use imagens: visual.kind só icon, diagram ou typographic."
      : "Use visual.kind = image na capa e em no máximo mais um slide.",
    "",
    data.references
      ? `Referências da equipe:\n${data.references}`
      : "Referências da equipe: nenhuma (não use números nem dados).",
    "",
    hasClient
      ? contextAllowed && brand
        ? `Perfil da marca:\n${brand}`
        : "Perfil da marca: não enviado (a organização não autorizou dados de clientes). Use tom neutro e profissional."
      : "Sem cliente vinculado: tom neutro e profissional.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export async function prepareCarousel(s: Scope, raw: CarouselGenerateInput): Promise<PreparedCarousel> {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = carouselGenerateInput.parse(raw);
  const text = await prepareStructured(s, { module: MODULE, task: "planning", selection: data.selection });
  const clientId = data.clientId ?? null;
  const client = clientId ? await loadClient(s, clientId, text.allowClientContext) : null;
  const userImages = [];
  for (const id of data.fileIds) {
    const img = await fileImage(s, id, clientId);
    if (!img) throw new ValidationError("Uma das imagens escolhidas não está disponível ou é de outro cliente.");
    userImages.push(img);
  }
  let image: PreparedImage | null = null;
  let imageWarning: string | null = null;
  if (data.images === "auto" && data.maxImages > 0) {
    if (!can(s.actor, "files.write")) {
      imageWarning = "Sem permissão para salvar em Arquivos: imagens de IA não serão geradas (só elementos vetoriais).";
    } else {
      try {
        image = await prepareImage(s, {
          prompt: "Imagem do carrossel.",
          size: data.format === "portrait" ? "1024x1536" : "1024x1024",
          clientId,
          projectId: data.projectId ?? null,
          module: MODULE,
          selection: data.imageSelection,
          saveToFiles: true,
          confirmCost: data.confirmCost,
        });
      } catch (err) {
        // Escolha explícita indisponível: erro (nunca troca de provedor em silêncio).
        if (err instanceof ModelSelectionError && data.imageSelection?.mode !== "manual") {
          imageWarning =
            "Nenhum modelo de geração de imagens configurado: o carrossel usa só formas, ícones e tipografia (nenhuma imagem simulada).";
        } else throw err;
      }
    }
  }
  const prompt = planPrompt(data, client?.context ?? "", text.allowClientContext, !!client);
  const maxTokens = assertCostConfirmed(text, {
    system: SYSTEM,
    prompt,
    maxTokens: 8000,
    confirmCost: data.confirmCost,
  });
  return { data, text, image, imageWarning, client, userImages, system: SYSTEM, prompt, maxTokens };
}

/* ------------------------------------------------------------------ */
/* Execução com progresso                                              */
/* ------------------------------------------------------------------ */

async function imageSize(buffer: Buffer) {
  const m = await sharp(buffer, { failOn: "none" }).metadata();
  return { width: m.width ?? 1024, height: m.height ?? 1024 };
}

export async function runCarouselGeneration(
  actor: Actor,
  p: PreparedCarousel,
  opts: { send: (e: CarouselEvent) => void; signal?: AbortSignal },
): Promise<{ ok: true; designId: string } | { ok: false; message: string }> {
  const { send } = opts;
  const { data } = p;
  const clientId = data.clientId ?? null;
  const warnings: string[] = [...p.text.warnings];
  if (p.imageWarning) warnings.push(p.imageWarning);
  if (p.text.demo) warnings.push("Modo demonstração: roteiro de exemplo gerado localmente. Revise todos os textos.");
  if (p.client && !p.text.allowClientContext)
    warnings.push(
      "O perfil da marca não foi enviado à IA (a organização não autorizou). A identidade visual foi aplicada localmente.",
    );
  send({
    t: "meta",
    demo: p.text.demo,
    provider: p.text.providerId,
    providerLabel: p.text.providerLabel,
    model: p.text.model.id,
    modelLabel: p.text.model.label,
    reason: p.text.reason,
    imageProvider: p.image?.providerLabel ?? null,
    imageModel: p.image?.model.label ?? null,
    warnings: [...warnings],
  });
  const fail = (message: string, kind = "unavailable") => {
    send({
      t: "error",
      message,
      kind,
      retryable: kind === "rate_limit" || kind === "unavailable" || kind === "bad_request",
    });
    return { ok: false as const, message };
  };

  // 1. Planejamento (estratégia + roteiro pela IA).
  send({ t: "step", step: "plan", status: "running" });
  let call: Awaited<ReturnType<typeof callStructured<z.infer<typeof aiPlanSchema>>>>;
  try {
    call = await callStructured(actor, p.text, {
      operation: "carousel_plan",
      system: p.system,
      prompt: p.prompt,
      schema: PLAN_JSON_SCHEMA,
      parse: aiPlanSchema,
      clientId,
      maxTokens: p.maxTokens,
      confirmCost: true,
      signal: opts.signal,
    });
  } catch (err) {
    const e = err as { message?: string; kind?: string };
    return fail(e.message ?? "Falha ao planejar o carrossel.", e.kind);
  }
  await inOrg(actor, (s) =>
    recordStructuredSuccess(s, call, {
      title: `Carrossel: ${data.topic}`.slice(0, 120),
      input: { topic: data.topic, objective: data.objective ?? "", slides: data.slides ?? null, clientId },
      clientId,
    }),
  );
  const notice = modelNotice(p.text, call.model);
  send({ t: "step", step: "plan", status: "done", detail: `${p.text.providerLabel} · ${call.model}` });

  // 2. Roteiro: regras sobre a resposta.
  send({ t: "step", step: "script", status: "running" });
  const imagesAvailable = data.images === "auto" && (!!p.image || p.userImages.length > 0);
  const input = {
    topic: data.topic,
    objective: data.objective ?? "",
    audience: data.audience ?? "",
    slides: data.slides ?? null,
    tone: data.tone ?? "",
    format: data.format,
    clientId,
    useIdentity: data.useIdentity,
    references: data.references ?? "",
    fileIds: data.fileIds,
    images: data.images,
  };
  const norm = normalizePlan(call.data, input, {
    imagesAvailable,
    newKey: (i) => `s${i + 1}`,
    newPageId: () => newId(),
  });
  warnings.push(...norm.warnings);
  send({
    t: "step",
    step: "script",
    status: "done",
    detail: `${norm.slides.length} slides${norm.claims.length ? ` · ${norm.claims.length} dado(s) a confirmar` : ""}`,
  });

  // 3. Recursos visuais.
  send({ t: "step", step: "visuals", status: "running" });
  const slides = norm.slides;
  const wantImage = slides.filter((s) => s.visual.kind === "image");
  // Imagens escolhidas pela equipe primeiro (capa, depois os demais slides com imagem).
  const userQueue = [...p.userImages];
  for (const s of [slides[0]!, ...wantImage.filter((x) => x !== slides[0])]) {
    const img = userQueue.shift();
    if (!img) break;
    s.visual = { ...s.visual, kind: "image", image: { ...img, origin: "files" } };
  }
  let generated = 0;
  let imageModel: string | null = null;
  // Uma imagem por slide, com o prompt do roteiro (limite de custo: maxImages).
  if (p.image) {
    const pending = wantImage.filter((s) => !s.visual.image).slice(0, data.maxImages);
    for (const s of pending) {
      if (opts.signal?.aborted) break;
      const prompt = (
        s.visual.prompt ||
        `Imagem editorial sobre ${data.topic}, sem texto escrito, sem logotipos e sem pessoas identificáveis.`
      ).slice(0, 3800);
      const prepared = await inOrg(actor, (sc) =>
        prepareImage(sc, {
          prompt,
          size: data.format === "portrait" ? "1024x1536" : "1024x1024",
          clientId,
          projectId: data.projectId ?? null,
          module: MODULE,
          selection: data.imageSelection,
          saveToFiles: true,
          confirmCost: true,
        }),
      ).catch((err: Error) => err);
      if (prepared instanceof Error) {
        warnings.push(`Imagem do slide "${s.title}" não gerada: ${prepared.message}`);
        s.visual = { ...s.visual, kind: "icon" };
        continue;
      }
      const res = await runImage(actor, prepared, { signal: opts.signal });
      const file = res.ok ? res.saved.files[0] : undefined;
      if (!res.ok || !file) {
        warnings.push(
          `Imagem do slide "${s.title}" não gerada: ${res.ok ? "não foi possível salvar em Arquivos." : res.message} O slide usa elementos vetoriais.`,
        );
        s.visual = { ...s.visual, kind: "icon" };
        continue;
      }
      const size = await imageSize(res.result.images[0]!);
      s.visual = { ...s.visual, image: { fileId: file.fileId, versionId: file.versionId, ...size, origin: "ai" } };
      imageModel = res.result.model;
      generated++;
    }
  }
  for (const s of slides) if (s.visual.kind === "image" && !s.visual.image) s.visual = { ...s.visual, kind: "icon" };
  const withImages = slides.filter((s) => s.visual.image).length;
  send({
    t: "step",
    step: "visuals",
    status: "done",
    detail: withImages
      ? `${withImages} imagem(ns)${generated ? ` · ${generated} gerada(s) por IA e salvas em Arquivos` : ""}`
      : "Somente elementos vetoriais (formas, ícones e tipografia)",
  });

  // 4. Montagem.
  send({ t: "step", step: "assemble", status: "running" });
  const seed = hashSeed(`${data.topic}|${clientId ?? ""}|${data.objective ?? ""}|${data.nonce ?? ""}`);
  const direction = buildDirection({
    seed,
    topic: `${data.topic} ${data.objective ?? ""}`,
    identity: p.client && data.useIdentity ? p.client.identity : null,
    suggestion: norm.suggestion,
  });
  const meta: GeneratorMeta = {
    v: 1,
    mode: data.mode,
    input,
    plan: norm.plan,
    slides: assignLayouts(slides, seed),
    claims: norm.claims,
    direction,
    ai: {
      provider: p.text.providerId,
      model: call.model,
      demo: p.text.demo,
      imageProvider: generated ? (p.image?.providerId ?? null) : null,
      imageModel,
    },
    visuals: withImages ? "images" : "vector",
    warnings: [...new Set(warnings)].slice(0, 20),
    version: 1,
    history: [{ at: new Date().toISOString(), action: "generated", slideKey: "", label: "Carrossel gerado" }],
    variantOf: null,
    createdAt: new Date().toISOString(),
  };
  const document = assembleDocument(meta);
  send({ t: "step", step: "assemble", status: "done", detail: direction.name });

  // 5. Salvamento (só "salvo" depois da confirmação do banco).
  send({ t: "step", step: "save", status: "running" });
  const size = FORMAT_SIZE[data.format];
  const name = (data.name || norm.plan.title || data.topic).slice(0, 120);
  let designId: string;
  try {
    ({ id: designId } = await inOrg(actor, (s) =>
      createDesign(s, {
        name,
        width: size.width,
        height: size.height,
        clientId,
        projectId: data.projectId ?? null,
        preset: size.preset,
        document: document as unknown as Record<string, unknown>,
      }),
    ));
  } catch (err) {
    console.error("[carrossel] falha ao salvar", err);
    return fail(
      `${(err as Error).message || "Não foi possível salvar o carrossel."}${generated ? " As imagens geradas ficaram em Arquivos." : ""}`,
      "save",
    );
  }
  send({ t: "step", step: "save", status: "done" });
  send({
    t: "done",
    designId,
    name,
    slides: meta.slides.length,
    claims: meta.claims,
    warnings: meta.warnings,
    visuals: meta.visuals,
    demo: p.text.demo,
    notice,
  });
  return { ok: true, designId };
}

/** Geração completa sem transmissão (testes e integrações). */
export async function generateCarousel(actor: Actor, raw: CarouselGenerateInput) {
  const prepared = await inOrg(actor, (s) => prepareCarousel(s, raw));
  const events: CarouselEvent[] = [];
  const res = await runCarouselGeneration(actor, prepared, { send: (e) => events.push(e) });
  return { ...res, events };
}

/* ------------------------------------------------------------------ */
/* Alterações depois de gerado                                          */
/* ------------------------------------------------------------------ */

function generatorOf(raw: Record<string, unknown>, size: { width: number; height: number }) {
  const { doc } = readDesignDocument(raw, size);
  const meta = doc.meta?.generator;
  if (!meta) throw new ValidationError("Esta arte não foi criada pelo gerador de carrosséis.");
  return { doc, meta };
}

/** Ordem atual das páginas geradas no documento (a pessoa pode ter reordenado). */
function syncOrder(doc: ReturnType<typeof generatorOf>["doc"], meta: GeneratorMeta): GeneratorMeta {
  const slides = currentSlides(doc, meta);
  const order = new Map(doc.pages.map((p, i) => [p.id, i]));
  const present = slides.filter((s) => order.has(s.pageId)).sort((a, b) => order.get(a.pageId)! - order.get(b.pageId)!);
  return { ...meta, slides: present.length ? present : slides };
}

function pageOps(meta: GeneratorMeta, docPages: { id: string }[], only?: Set<string>) {
  const ops: DesignOp[] = [];
  meta.slides.forEach((s, i) => {
    if (only && !only.has(s.pageId)) return;
    if (!docPages.some((p) => p.id === s.pageId)) return;
    ops.push({ op: "replacePage", page: renderGeneratedPage(meta, i) });
  });
  return ops;
}

function historyEntry(
  meta: GeneratorMeta,
  action: GeneratorMeta["history"][number]["action"],
  label: string,
  slideKey = "",
) {
  return [...meta.history, { at: new Date().toISOString(), action, slideKey, label: label.slice(0, 240) }].slice(-40);
}

const slideRequest = z.object({
  designId: z.uuid(),
  pageId: z.string().min(1).max(64),
  instruction: z.string().trim().max(500).optional(),
  keepImage: z.boolean().default(true),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

export const regenerateSlideInput = slideRequest.extend({ revision: z.number().int().min(0) });
/** Prévia para o chat de edição: calcula as operações sem aplicar (documento do editor, se enviado). */
export const planSlideInput = slideRequest.extend({ document: z.record(z.string(), z.unknown()).optional() });

/** Documento de trabalho: o enviado pelo editor (com alterações locais) ou o salvo. */
function workingDoc(d: { document: unknown; width: number; height: number }, document?: Record<string, unknown>) {
  return generatorOf((document ?? d.document) as Record<string, unknown>, d);
}

async function computeSlide(
  actor: Actor,
  data: z.output<typeof slideRequest>,
  opts: { revision?: number; document?: Record<string, unknown> },
) {
  const pre = await inOrg(actor, async (s) => {
    assertInternal(s.actor);
    assertCan(s.actor, "designs.write");
    const d = (await getDesign(s, data.designId)).design;
    if (opts.revision !== undefined && d.revision !== opts.revision)
      throw new ConflictError("A arte mudou desde que foi lida. Carregue a versão atual e tente de novo.");
    const { doc, meta: stored } = workingDoc(d, opts.document);
    const meta = syncOrder(doc, stored);
    const index = meta.slides.findIndex((x) => x.pageId === data.pageId);
    if (index < 0) throw new ValidationError("Este slide não foi criado pelo gerador (ou foi excluído).");
    const text = await prepareStructured(s, { module: MODULE, task: "copy", selection: data.selection });
    const client =
      d.clientId && text.allowClientContext ? await loadClient(s, d.clientId, true).catch(() => null) : null;
    return { d, doc, meta, index, text, brand: client?.context ?? "" };
  });
  const { meta, index, text } = pre;
  const slide = meta.slides[index]!;
  const prompt = [
    "Formato da resposta: carousel_slide",
    `Tema: ${meta.input.topic}`,
    meta.input.objective ? `Objetivo: ${meta.input.objective}` : null,
    meta.input.audience ? `Público: ${meta.input.audience}` : null,
    meta.input.tone ? `Tom: ${meta.input.tone}` : null,
    `Papel do slide: ${slide.role}`,
    `Posição: ${index + 1} de ${meta.slides.length}`,
    `Versão: ${meta.version + 1}`,
    data.instruction
      ? `Pedido de ajuste: ${data.instruction}`
      : "Pedido de ajuste: reescreva com outra abordagem, mantendo a continuidade.",
    "",
    "Roteiro atual (para manter a continuidade):",
    ...meta.slides.map((x, i) => `${i + 1}. [${x.role}] ${x.title}${i === index ? "  ← este slide" : ""}`),
    "",
    `Texto atual deste slide: ${[slide.kicker, slide.title, slide.body, ...slide.bullets].filter(Boolean).join(" | ")}`,
    meta.input.references
      ? `\nReferências da equipe:\n${meta.input.references}`
      : "\nReferências da equipe: nenhuma (não use números nem dados).",
    pre.brand ? `\nPerfil da marca:\n${pre.brand}` : null,
    "Devolva o slide no mesmo papel e as afirmações que precisam de fonte.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const call = await callStructured(actor, text, {
    operation: "carousel_slide",
    system: SYSTEM,
    prompt,
    schema: SLIDE_JSON_SCHEMA,
    parse: slideResponseSchema,
    clientId: pre.d.clientId,
    maxTokens: 2500,
    confirmCost: data.confirmCost,
  });
  const allowed = numbersIn(
    [meta.input.topic, meta.input.objective, meta.input.audience, meta.input.tone, meta.input.references].join("\n"),
  );
  const norm = normalizeSlide(call.data.slide, {
    key: slide.key,
    pageId: slide.pageId,
    allowed,
    imagesAvailable: !!slide.visual.image,
    topic: meta.input.topic,
    forceRole: slide.role,
  });
  const next: GeneratorSlide = {
    ...norm.slide,
    visual:
      data.keepImage && slide.visual.image
        ? { ...norm.slide.visual, kind: "image", image: slide.visual.image }
        : norm.slide.visual,
  };
  next.layout = assignLayouts([next], meta.direction.seed + meta.version)[0]!.layout;
  const slides = meta.slides.map((x, i) => (i === index ? next : x));
  const claims = [
    ...meta.claims.filter((c) => c.slideKey !== slide.key),
    ...norm.claims,
    ...call.data.claims.map((c) => ({
      text: c.text.slice(0, 380),
      slideKey: slide.key,
      reason: (c.reason || "Afirmação que precisa de fonte.").slice(0, 380),
    })),
  ].slice(0, 20);
  const nextMeta: GeneratorMeta = {
    ...meta,
    slides,
    claims,
    warnings: [...new Set([...meta.warnings, ...norm.warnings])].slice(0, 20),
    version: meta.version + 1,
    ai: { ...meta.ai, provider: text.providerId, model: call.model, demo: text.demo },
    history: historyEntry(
      meta,
      "slide",
      `Slide ${index + 1} regenerado${data.instruction ? `: ${data.instruction}` : ""}`,
      slide.key,
    ),
  };
  const ops: DesignOp[] = [
    ...pageOps(nextMeta, pre.doc.pages, new Set([slide.pageId])),
    { op: "replaceMeta", meta: { ...pre.doc.meta, generator: nextMeta } },
  ];
  const record = (s: Scope) =>
    recordStructuredSuccess(s, call, {
      title: `Slide ${index + 1} regenerado: ${meta.input.topic}`.slice(0, 120),
      input: { designId: data.designId, pageId: data.pageId, instruction: data.instruction ?? "" },
      clientId: pre.d.clientId,
    });
  return { ops, index, nextMeta, norm, text, call, record };
}

/**
 * Regenera o texto e a composição de UM slide com a IA (mantém papel,
 * direção visual e a imagem, salvo pedido contrário). Grava uma versão
 * "Antes de regenerar…" e aplica as operações com controle de revisão.
 */
export async function regenerateCarouselSlide(actor: Actor, raw: z.input<typeof regenerateSlideInput>) {
  const data = regenerateSlideInput.parse(raw);
  const r = await computeSlide(actor, data, { revision: data.revision });
  const result = await inOrg(actor, async (s) => {
    const applied = await applyDesignOperations(s, {
      designId: data.designId,
      revision: data.revision,
      ops: r.ops,
      checkpointLabel: `Antes de regenerar o slide ${r.index + 1}`,
    });
    await r.record(s);
    return applied;
  });
  return {
    revision: result.revision,
    ops: result.applied,
    slideIndex: r.index,
    claims: r.nextMeta.claims,
    warnings: r.norm.warnings,
    demo: r.text.demo,
    notice: modelNotice(r.text, r.call.model),
  };
}

/**
 * Mesma regeneração, SEM aplicar: devolve as operações para a prévia do chat
 * de edição (quem aplica é o chat, com o próprio ponto de controle).
 */
export async function planCarouselSlide(actor: Actor, raw: z.input<typeof planSlideInput>) {
  const data = planSlideInput.parse(raw);
  const r = await computeSlide(actor, data, { document: data.document });
  const generationId = await inOrg(actor, (s) => r.record(s));
  return {
    ops: r.ops,
    slideIndex: r.index,
    title: r.nextMeta.slides[r.index]!.title,
    claims: r.nextMeta.claims,
    warnings: r.norm.warnings,
    demo: r.text.demo,
    notice: modelNotice(r.text, r.call.model),
    generationId,
  };
}

export const restyleInput = z.object({
  designId: z.uuid(),
  revision: z.number().int().min(0),
});
export const planRestyleInput = z.object({
  designId: z.uuid(),
  document: z.record(z.string(), z.unknown()).optional(),
});

function styleKeyOf(d: GeneratorMeta["direction"]) {
  const parts = d.key.split("-");
  const style = STYLES.find((s) => s.key === parts.at(-1))?.key;
  const palette = PALETTES.find((p) => p.key === parts[0])?.key;
  return { style, palette };
}

async function computeRestyle(
  s: Scope,
  d: { clientId: string | null; document: unknown; width: number; height: number },
  document?: Record<string, unknown>,
) {
  const { doc, meta: stored } = workingDoc(d, document);
  const meta = syncOrder(doc, stored);
  const old = styleKeyOf(meta.direction);
  const identity = meta.direction.fromIdentity && d.clientId ? (await loadClient(s, d.clientId, false)).identity : null;
  const seed = hashSeed(`${meta.direction.seed}|restyle|${meta.version}`);
  const direction = buildDirection({
    seed,
    topic: `${meta.input.topic} ${meta.input.objective}`,
    identity,
    exclude: { style: old.style, palette: old.palette, motif: meta.direction.motif },
  });
  const nextMeta: GeneratorMeta = {
    ...meta,
    direction,
    slides: assignLayouts(meta.slides, seed),
    version: meta.version + 1,
    history: historyEntry(meta, "direction", `Nova direção visual: ${direction.name}`),
  };
  const ops: DesignOp[] = [
    ...pageOps(nextMeta, doc.pages),
    { op: "replaceMeta", meta: { ...doc.meta, generator: nextMeta } },
  ];
  return { ops, direction: direction.name };
}

/**
 * Nova direção visual mantendo os textos (inclusive os editados no editor) e
 * as imagens: outro estilo tipográfico, motivo de continuidade, composição e
 * — sem identidade do cliente — outra paleta. Sem custo de IA.
 */
export async function restyleCarousel(s: Scope, raw: z.input<typeof restyleInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = restyleInput.parse(raw);
  const d = (await getDesign(s, data.designId)).design;
  const r = await computeRestyle(s, d);
  const result = await applyDesignOperations(s, {
    designId: data.designId,
    revision: data.revision,
    ops: r.ops,
    checkpointLabel: "Antes de trocar a direção visual",
  });
  return { revision: result.revision, ops: result.applied, direction: r.direction };
}

/** Nova direção visual SEM aplicar (prévia do chat de edição). */
export async function planCarouselRestyle(s: Scope, raw: z.input<typeof planRestyleInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = planRestyleInput.parse(raw);
  const d = (await getDesign(s, data.designId)).design;
  return computeRestyle(s, d, data.document);
}

export const variantInput = z.object({
  designId: z.uuid(),
  /** Documento do editor (com alterações ainda não salvas), quando houver. */
  document: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Segunda versão: arte NOVA com os mesmos textos e a mesma identidade, mas
 * outra composição em cada slide e outro motivo de continuidade. A original
 * não muda.
 */
export async function createCarouselVariant(s: Scope, raw: z.input<typeof variantInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = variantInput.parse(raw);
  const src = await getDesign(s, data.designId);
  const d = src.design;
  const { doc, meta: stored } = workingDoc(d, data.document);
  const meta = syncOrder(doc, stored);
  const seed = hashSeed(`${meta.direction.seed}|variant|${meta.version}`);
  const motifs = MOTIFS.filter((m) => m !== meta.direction.motif);
  const direction = { ...meta.direction, seed, motif: motifs[seed % motifs.length]! };
  const slides = assignLayouts(
    meta.slides.map((x) => ({ ...x, pageId: newId() })),
    seed,
    meta.slides.map((x) => x.layout),
  );
  const nextMeta: GeneratorMeta = {
    ...meta,
    slides,
    direction,
    version: 1,
    variantOf: d.id,
    history: [
      { at: new Date().toISOString(), action: "variant", slideKey: "", label: `Segunda versão de "${d.name}"` },
    ],
    createdAt: new Date().toISOString(),
  };
  const document = assembleDocument(nextMeta);
  const created = await createDesign(s, {
    name: `${d.name} — versão 2`.slice(0, 120),
    width: d.width,
    height: d.height,
    clientId: d.clientId,
    projectId: d.projectId,
    preset: FORMAT_SIZE[meta.input.format].preset,
    document: document as unknown as Record<string, unknown>,
  });
  return { id: created.id, layouts: slides.map((x) => x.layout) };
}

/** Resumo do plano para a interface (painel do gerador no editor). */
export function generatorSummary(meta: GeneratorMeta) {
  return {
    title: meta.plan.title,
    direction: meta.direction.name,
    demo: meta.ai.demo,
    visuals: meta.visuals,
    version: meta.version,
    claims: meta.claims,
    warnings: meta.warnings,
    caption: meta.plan.caption,
    hashtags: meta.plan.hashtags,
    slides: meta.slides.map((s) => ({ pageId: s.pageId, role: SLIDE_ROLE_LABEL[s.role], title: s.title })),
  };
}
