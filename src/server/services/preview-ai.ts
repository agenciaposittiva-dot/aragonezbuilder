import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { runPreviewChecks } from "@/lib/preview-check";
import {
  automaticProposal,
  CONVERT_TARGET_LABEL,
  CONVERT_TARGETS,
  conversionProposalSchema,
  type ConversionProposal,
} from "@/lib/preview-convert";
import { checkInputOf, pageTextsOf, type PreviewData } from "@/lib/preview-data";
import {
  isNetworkKey,
  isPlacementKey,
  NETWORK_KEYS,
  PLACEMENT_KEYS,
  SOCIAL_SPECS,
  type NetworkKey,
  type PlacementKey,
} from "@/lib/social-specs";
import { AiProviderError } from "@/server/ai/types";
import { assertCan, assertInternal, inOrg, type Actor, type Scope } from "@/server/authz";
import { brandProfiles } from "@/server/db/schema";
import { AppError, ValidationError } from "@/server/errors";
import { assertCanGenerate, CostConfirmationError, estimateMaxCostMicros, recordUsage, saveGeneration } from "./ai";
import { aiSelectionInput, resolveSelection } from "./ai-models";
import { getContentPreview, getDesignPreview } from "./content-preview";

/*
 * IA da Central de pré-visualização. Só SUGERE: a revisão devolve
 * observações (e, se pedir, uma legenda alternativa que a pessoa aplica ou
 * não) e a conversão devolve um rascunho editável que só vira peça nova
 * quando a pessoa aceita. Nada é publicado nem alterado aqui.
 * Os textos das peças são de clientes: só vão ao provedor com a autorização
 * da organização (ou no modo demonstração, que é local).
 */

export const PREVIEW_POLICY_MESSAGE =
  "A política de IA da organização não permite enviar os textos das peças ao provedor. Um administrador pode liberar em Configurações → Inteligência artificial (“Enviar contexto dos clientes ao provedor”). A conversão automática, sem IA, continua disponível.";

export class PreviewAiError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "PreviewAiError";
  }
}

type Prepared = {
  provider: ReturnType<NonNullable<Awaited<ReturnType<typeof resolveSelection>>["def"]["text"]>>;
  providerId: string;
  model: Awaited<ReturnType<typeof resolveSelection>>["model"];
  source: string;
  demo: boolean;
  confirmAboveMicros: number;
};

async function prepare(s: Scope, selection: unknown): Promise<Prepared> {
  assertInternal(s.actor);
  const settings = await assertCanGenerate(s);
  const resolved = await resolveSelection(s, {
    module: "preview",
    task: "copy",
    selection: aiSelectionInput.parse(selection ?? {}),
  });
  const def = resolved.def;
  if (!def.text) throw new PreviewAiError(`${def.label} não gera texto. Escolha um modelo de texto.`);
  const demo = def.id === "demo";
  if (!demo && !settings.allowClientContext) throw new ValidationError(PREVIEW_POLICY_MESSAGE);
  return {
    provider: def.text(resolved.apiKey ?? ""),
    providerId: def.id,
    model: resolved.model,
    source: resolved.source,
    demo,
    confirmAboveMicros: settings.confirmAboveMicros,
  };
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

async function callModel<T>(
  actor: Actor,
  prep: Prepared,
  req: {
    operation: "preview_review" | "preview_convert";
    title: string;
    input: Record<string, unknown>;
    prompt: string;
    schema: Record<string, unknown>;
    parse: z.ZodType<T>;
    clientId: string | null;
    maxTokens: number;
    confirmCost?: boolean;
  },
) {
  const maxTokens = Math.min(req.maxTokens, prep.model.maxOutputTokens ?? req.maxTokens);
  const estimate = estimateMaxCostMicros(prep.model, SYSTEM.length + req.prompt.length, maxTokens);
  if (prep.confirmAboveMicros > 0 && estimate !== null && estimate > prep.confirmAboveMicros && !req.confirmCost) {
    throw new CostConfirmationError(estimate);
  }
  const usage = {
    provider: prep.providerId,
    model: prep.model.id,
    operation: req.operation,
    module: "preview",
    task: "copy",
    selectionSource: prep.source,
    clientId: req.clientId,
  };
  const started = Date.now();
  let tokens: { inputTokens: number; outputTokens: number; costMicros: number | null } | null = null;
  let data: T;
  let raw: string;
  let model: string;
  try {
    const result = await prep.provider.generate({
      model: prep.model.id,
      modelCaps: prep.model.caps,
      system: SYSTEM,
      prompt: req.prompt,
      maxTokens,
      jsonSchema: req.schema,
    });
    tokens = result;
    const parsed = req.parse.safeParse(parseJson(result.text));
    if (!parsed.success) {
      throw new AiProviderError("O modelo devolveu campos incompletos. Tente novamente.", "bad_request");
    }
    data = parsed.data;
    raw = result.text;
    model = result.model || prep.model.id;
  } catch (err) {
    const message = err instanceof AiProviderError ? err.message : "Falha ao consultar a IA. Tente novamente.";
    if (!(err instanceof AiProviderError)) console.error("[prévia] erro na IA", err);
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
    throw new PreviewAiError(message);
  }
  // Toda chamada fica registrada no uso e no histórico do Assistente.
  await inOrg(actor, async (s) => {
    const usageId = await recordUsage(s, {
      ...usage,
      model,
      inputTokens: tokens!.inputTokens,
      outputTokens: tokens!.outputTokens,
      costMicros: tokens!.costMicros,
      status: "success",
      latencyMs: Date.now() - started,
    });
    await saveGeneration(s, {
      usageId,
      kind: req.operation,
      title: req.title,
      input: req.input,
      output: raw,
      provider: prep.providerId,
      model,
      clientId: req.clientId,
    });
  });
  return { data, model };
}

const SYSTEM = [
  "Você revisa peças de redes sociais de uma agência de marketing brasileira antes de irem para aprovação.",
  "Trabalhe só com o que foi enviado (textos, legenda, medidas e o resultado da verificação automática).",
  "Você não vê a imagem: não invente cores, fotos ou elementos que não estejam descritos.",
  "Sugira melhorias objetivas; não prometa alcance, engajamento ou resultados.",
  "Responda em português do Brasil, exclusivamente com o JSON pedido.",
].join(" ");

async function brandLines(s: Scope, clientId: string | null) {
  if (!clientId) return [];
  const [b] = await s.db
    .select({
      tone: brandProfiles.toneOfVoice,
      audience: brandProfiles.audience,
      keywords: brandProfiles.keywords,
      avoid: brandProfiles.avoid,
    })
    .from(brandProfiles)
    .where(eq(brandProfiles.clientId, clientId));
  if (!b) return [];
  return [
    b.tone ? `Tom de voz da marca: ${b.tone.slice(0, 300)}` : null,
    b.audience ? `Público: ${b.audience.slice(0, 300)}` : null,
    b.keywords?.length ? `Palavras-chave: ${b.keywords.slice(0, 12).join(", ")}` : null,
    b.avoid ? `Evitar: ${b.avoid.slice(0, 300)}` : null,
  ].filter((x): x is string => !!x);
}

function describePiece(p: PreviewData, network: NetworkKey, placement: PlacementKey) {
  const c = p.content;
  const spec = SOCIAL_SPECS[network];
  const pages = pageTextsOf(p.designs, p.slides);
  return [
    `Rede: ${spec.label}${spec.fidelity === "approximate" ? " (medidas aproximadas)" : ""}`,
    `Formato atual: ${spec.placements[placement]?.label ?? placement}`,
    c ? `Título interno: ${c.title}` : `Arte: ${p.design?.name ?? ""}`,
    c?.copy ? `Texto principal: ${c.copy}` : null,
    `Legenda: ${c?.caption?.trim() || "(sem legenda)"}`,
    c ? `Hashtags: ${c.hashtags.join(" ") || "(nenhuma)"}` : null,
    c ? `Chamada para ação: ${c.cta?.trim() || "(nenhuma)"}` : null,
    `Páginas (${p.slides.length}):`,
    ...p.slides.map((s) => {
      const t = pages.find((x) => x.key === s.key);
      const texts = t?.texts.map(
        (x) => `“${x.text.replace(/\s+/g, " ").slice(0, 200)}” (${Math.round(x.fontSize)} px)`,
      );
      return `- ${s.label} (${s.width} × ${s.height}): ${texts?.length ? texts.join("; ") : s.kind === "file" ? "arquivo de mídia, sem camadas" : "sem textos"}`;
    }),
  ].filter((x): x is string => !!x);
}

/* ------------------------------------------------------------------ */
/* Revisão                                                             */
/* ------------------------------------------------------------------ */

export const REVIEW_AREAS = {
  composicao: "Composição",
  hierarquia: "Hierarquia",
  legenda: "Legenda",
  consistencia: "Consistência",
  formato: "Formato",
} as const;
type ReviewArea = keyof typeof REVIEW_AREAS;
const AREA_KEYS = Object.keys(REVIEW_AREAS) as [ReviewArea, ...ReviewArea[]];

const reviewResponse = z.object({
  summary: z.string().max(1200),
  suggestions: z
    .array(
      z.object({
        area: z.enum(AREA_KEYS),
        page: z.string().max(60).nullable(),
        text: z.string().max(600),
      }),
    )
    .max(12),
  caption: z.string().max(4000).nullable(),
});
export type PreviewReview = z.infer<typeof reviewResponse>;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          area: { type: "string", enum: AREA_KEYS },
          page: { type: ["string", "null"] },
          text: { type: "string" },
        },
        required: ["area", "page", "text"],
        additionalProperties: false,
      },
    },
    caption: { type: ["string", "null"] },
  },
  required: ["summary", "suggestions", "caption"],
  additionalProperties: false,
};

const target = {
  network: z.enum(NETWORK_KEYS),
  placement: z.enum(PLACEMENT_KEYS),
};

export const previewReviewInput = z
  .object({
    contentId: z.uuid().optional(),
    designId: z.uuid().optional(),
    ...target,
    selection: aiSelectionInput.optional(),
    confirmCost: z.boolean().optional(),
  })
  .refine((v) => !!v.contentId !== !!v.designId, "Informe a peça ou a arte.");

async function loadPreview(s: Scope, ref: { contentId?: string; designId?: string }) {
  return ref.contentId ? getContentPreview(s, ref.contentId) : getDesignPreview(s, ref.designId!);
}

/** Revisão da peça por IA: composição, hierarquia, legenda e consistência (só sugestões). */
export async function reviewPreview(actor: Actor, raw: z.input<typeof previewReviewInput>) {
  const data = previewReviewInput.parse(raw);
  const { prep, preview, brand } = await inOrg(actor, async (s) => {
    const prep = await prepare(s, data.selection);
    const preview = await loadPreview(s, data);
    return { prep, preview, brand: await brandLines(s, preview.client?.id ?? null) };
  });
  const issues = runPreviewChecks(checkInputOf(preview, data));
  const prompt = [
    "Formato da resposta: preview_review",
    "Revise a peça abaixo para a rede e o formato indicados. Devolva um resumo curto, até 8 sugestões (área: composicao, hierarquia, legenda, consistencia ou formato; página quando se aplicar) e, se a legenda puder melhorar, uma legenda alternativa completa (senão null). Não repita literalmente os avisos da verificação automática; use-os para priorizar.",
    "",
    ...describePiece(preview, data.network, data.placement),
    ...(brand.length ? ["", ...brand] : []),
    "",
    "Verificação automática da plataforma:",
    ...(issues.length ? issues.map((i) => `- [${i.level}] ${i.message}`) : ["- nenhum alerta"]),
  ].join("\n");
  const call = await callModel(actor, prep, {
    operation: "preview_review",
    title: `Revisão da prévia: ${preview.content?.title ?? preview.design?.name ?? "peça"}`,
    input: {
      contentId: data.contentId ?? null,
      designId: data.designId ?? null,
      network: data.network,
      placement: data.placement,
    },
    prompt,
    schema: REVIEW_SCHEMA,
    parse: reviewResponse,
    clientId: preview.client?.id ?? null,
    maxTokens: 2500,
    confirmCost: data.confirmCost,
  });
  const labels = new Set(preview.slides.map((s) => s.label));
  return {
    review: {
      ...call.data,
      // Página que não existe na peça não vira link quebrado.
      suggestions: call.data.suggestions.map((x) => ({ ...x, page: x.page && labels.has(x.page) ? x.page : null })),
      caption: preview.content ? call.data.caption : null,
    },
    demo: prep.demo,
    model: call.model,
  };
}

/* ------------------------------------------------------------------ */
/* Conversão                                                           */
/* ------------------------------------------------------------------ */

const CONVERT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, text: { type: "string" } },
        required: ["title", "text"],
        additionalProperties: false,
      },
    },
    caption: { type: ["string", "null"] },
    cta: { type: ["string", "null"] },
  },
  required: ["title", "slides", "caption", "cta"],
  additionalProperties: false,
};

export const previewConvertInput = z.object({
  contentId: z.uuid(),
  target: z.enum(CONVERT_TARGETS),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

function sourceOf(p: PreviewData) {
  const c = p.content!;
  const pages = pageTextsOf(p.designs, p.slides);
  // Páginas da arte (título = maior texto) quando existirem; senão, os textos da peça.
  const fromPages = pages
    .map((pg) => ({
      title: pg.texts[0]?.text ?? "",
      text: pg.texts
        .slice(1)
        .map((t) => t.text)
        .join("\n"),
    }))
    .filter((x) => x.title || x.text);
  return {
    title: c.title,
    copy: c.copy,
    caption: c.caption,
    cta: c.cta,
    slides: c.slides.length ? c.slides : fromPages.length > 1 ? fromPages.slice(1) : [],
  };
}

/** Rascunho de conversão sem IA (sempre disponível). */
export async function automaticConversion(
  s: Scope,
  raw: { contentId: string; target: (typeof CONVERT_TARGETS)[number] },
) {
  assertInternal(s.actor);
  assertCan(s.actor, "content.write");
  const p = await getContentPreview(s, raw.contentId);
  return automaticProposal(sourceOf(p), raw.target);
}

/** Rascunho de conversão por IA (feed → carrossel ou Stories e vice-versa). Nada é criado aqui. */
export async function convertPreview(actor: Actor, raw: z.input<typeof previewConvertInput>) {
  const data = previewConvertInput.parse(raw);
  const { prep, preview, brand } = await inOrg(actor, async (s) => {
    assertCan(s.actor, "content.write");
    const prep = await prepare(s, data.selection);
    const preview = await getContentPreview(s, data.contentId);
    return { prep, preview, brand: await brandLines(s, preview.client?.id ?? null) };
  });
  const base: ConversionProposal = automaticProposal(sourceOf(preview), data.target);
  const network = isNetworkKey(preview.content?.network) ? preview.content.network : "instagram";
  const placement = isPlacementKey(preview.content?.placement) ? preview.content.placement : "feed_portrait";
  const limits =
    data.target === "stories"
      ? "de 3 a 5 telas curtas (textos de leitura rápida, uma ideia por tela)"
      : data.target === "carousel"
        ? "de 4 a 8 páginas (capa forte, desenvolvimento em passos e página final com a chamada)"
        : "uma única página com a mensagem principal";
  const prompt = [
    "Formato da resposta: preview_convert",
    `Destino: ${CONVERT_TARGET_LABEL[data.target]}`,
    `Reescreva a peça abaixo como ${CONVERT_TARGET_LABEL[data.target].toLowerCase()} com ${limits}. Cada página tem um título curto e um texto de apoio (pode ser vazio). Mantenha a mensagem, o tom e as informações da peça original; não invente dados, preços ou promessas. Ajuste a legenda ao novo formato e mantenha a chamada para ação.`,
    "",
    ...describePiece(preview, network, placement),
    ...(brand.length ? ["", ...brand] : []),
    "",
    `Rascunho base (JSON): ${JSON.stringify(base)}`,
  ].join("\n");
  const call = await callModel(actor, prep, {
    operation: "preview_convert",
    title: `Conversão para ${CONVERT_TARGET_LABEL[data.target]}: ${preview.content!.title}`,
    input: { contentId: data.contentId, target: data.target },
    prompt,
    schema: CONVERT_SCHEMA,
    parse: conversionProposalSchema,
    clientId: preview.client?.id ?? null,
    maxTokens: 3000,
    confirmCost: data.confirmCost,
  });
  const proposal = { ...call.data, slides: data.target === "feed" ? call.data.slides.slice(0, 1) : call.data.slides };
  return { proposal, demo: prep.demo, model: call.model };
}
