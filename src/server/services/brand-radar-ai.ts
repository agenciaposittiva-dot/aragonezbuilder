import { and, desc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  availableRequirements,
  BIO_STYLES,
  BRAND_AI_ACTIONS,
  BRAND_DIMENSIONS,
  BRAND_METHODOLOGY_VERSION,
  completenessScore,
  CONTENT_CATEGORIES,
  countChars,
  DIMENSION_KEYS,
  formatsScore,
  LEVEL3,
  overallScore,
  performanceScore,
  POST_FORMATS,
  PRESENCE,
  RECOMMENDATION_AREAS,
  RECOMMENDATION_CATEGORIES,
  SCREENSHOT_KINDS,
  SOURCE_LABEL,
  type ApiPost,
  type Basis,
  type BioRewriteResult,
  type BioVersionDraft,
  type BrandAiAction,
  type DiagnosisInputs,
  type DiagnosisKind,
  type DiagnosisResult,
  type DimensionKey,
  type DimensionResult,
  type Finding,
  type HighlightPlan,
  type NicheResult,
  type RecommendationDraft,
  type Requirement,
  type Screenshot,
  type SourceKind,
} from "@/lib/brand-radar";
import { inOrg, type Actor, type Scope } from "@/server/authz";
import { AiProviderError, type AiImageInput } from "@/server/ai/types";
import {
  brandRadarBioVersions,
  brandRadarDiagnoses,
  brandRadarProfiles,
  brandRadarRecommendations,
  fileVersions,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import { recordActivity } from "./activity";
import { assertCanGenerate, CostConfirmationError, estimateMaxCostMicros, recordUsage, saveGeneration } from "./ai";
import { aiSelectionInput, resolveSelection } from "./ai-models";
import { assertBrandManage, buildInputs, loadProfile, radarSettings } from "./brand-radar";
import { stripUnsupportedNumbers } from "./trends-ai";

/*
 * IA do Radar de Marca. O modelo recebe só os dados com fonte e data (e as
 * capturas de tela, quando o modelo escolhido lê imagens) e devolve
 * AVALIAÇÕES. Regras do sistema aplicadas depois da resposta (ficam em
 * `guardrails` e aparecem na tela):
 *  - dimensões sem os dados exigidos ficam "não avaliadas" e fora da nota,
 *    mesmo que a IA tenha dado nota;
 *  - completude, formatos e desempenho são calculados por regra, nunca pela IA;
 *  - desempenho só com métricas reais da conta conectada;
 *  - números que não constam nos dados são removidos dos textos;
 *  - "observado" sem evidência vira "avaliação da IA" (hipótese);
 *  - identidade visual só é avaliada quando as imagens foram de fato enviadas;
 *  - sem publicações, as categorias de conteúdo ficam "não dá para avaliar";
 *  - a contagem de caracteres da bio é refeita pelo sistema.
 * Nenhum provedor é trocado em silêncio: o modelo usado fica gravado.
 * A rede do provedor é chamada FORA de transações do banco.
 */

export class BrandAiError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "BrandAiError";
  }
}

const MAX_IMAGES = 6;

const REQUIREMENT_LABEL: Record<Requirement, string> = {
  profile_text: "bio, nome ou categoria do perfil",
  highlights: "destaques",
  posts: "publicações",
  visual: "capturas de tela lidas por um modelo com visão",
  niche: "nicho ou público do cliente",
  metrics: "métricas reais da conta conectada",
};

/* ------------------------------------------------------------------ */
/* Preparação e chamada ao provedor                                    */
/* ------------------------------------------------------------------ */

type Resolved = Awaited<ReturnType<typeof resolveSelection>>;
type Prepared = {
  provider: ReturnType<NonNullable<Resolved["def"]["text"]>>;
  providerId: string;
  model: Resolved["model"];
  source: string;
  demo: boolean;
  allowClientContext: boolean;
  confirmAboveMicros: number;
};

async function prepare(s: Scope, selection: unknown): Promise<Prepared> {
  const settings = await assertCanGenerate(s);
  const resolved = await resolveSelection(s, {
    module: "brand",
    task: "brand_analysis",
    selection: aiSelectionInput.parse(selection ?? {}),
  });
  const def = resolved.def;
  if (!def.text) throw new BrandAiError(`${def.label} não gera texto. Escolha um modelo de texto.`);
  return {
    provider: def.text(resolved.apiKey ?? "", { baseUrl: resolved.baseUrl }),
    providerId: def.id,
    model: resolved.model,
    source: resolved.source,
    demo: def.id === "demo",
    allowClientContext: settings.allowClientContext || def.id === "demo",
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
    operation: string;
    system: string;
    prompt: string;
    images: AiImageInput[];
    schema: Record<string, unknown>;
    parse: z.ZodType<T>;
    clientId: string;
    maxTokens: number;
    confirmCost?: boolean;
  },
) {
  const maxTokens = Math.min(req.maxTokens, prep.model.maxOutputTokens ?? req.maxTokens);
  // Cada imagem pesa como um texto longo na estimativa (as tabelas de preço cobram por tokens).
  const chars = req.system.length + req.prompt.length + req.images.length * 6000;
  const estimate = estimateMaxCostMicros(prep.model, chars, maxTokens);
  if (prep.confirmAboveMicros > 0 && estimate !== null && estimate > prep.confirmAboveMicros && !req.confirmCost) {
    throw new CostConfirmationError(estimate);
  }
  const started = Date.now();
  const usage = {
    provider: prep.providerId,
    model: prep.model.id,
    operation: req.operation,
    module: "brand",
    task: "brand_analysis",
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
      images: req.images.length ? req.images : undefined,
      maxTokens,
      jsonSchema: req.schema,
    });
    tokens = result;
    const parsed = req.parse.safeParse(parseJson(result.text));
    if (!parsed.success) {
      throw new AiProviderError("O modelo devolveu campos incompletos. Tente novamente.", "bad_request");
    }
    return {
      data: parsed.data,
      model: result.model || prep.model.id,
      raw: result.text,
      tokens: result,
      latency: Date.now() - started,
      usage,
    };
  } catch (err) {
    let message = err instanceof AiProviderError ? err.message : "Falha ao consultar a IA. Tente novamente.";
    if (err instanceof AiProviderError && err.kind === "bad_request" && req.images.length && !tokens) {
      message =
        "O modelo escolhido recusou as imagens: ele pode não ler capturas de tela. Escolha um modelo com leitura de imagens ou desmarque o envio das capturas.";
    }
    if (!(err instanceof AiProviderError)) console.error("[radar de marca] erro na IA", err);
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
    throw new BrandAiError(message);
  }
}

async function recordSuccess(
  s: Scope,
  call: Awaited<ReturnType<typeof callModel>>,
  g: { title: string; input: Record<string, unknown>; clientId: string },
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

/** Capturas reduzidas (lado maior de 1568 px, JPEG) para enviar ao modelo com visão. */
async function loadImages(s: Scope, shots: Screenshot[]) {
  const list = shots.slice(0, MAX_IMAGES);
  if (!list.length) return [];
  const rows = await s.db
    .select({ id: fileVersions.id, key: fileVersions.storageKey, mime: fileVersions.mimeType })
    .from(fileVersions)
    .where(
      inArray(
        fileVersions.id,
        list.map((x) => x.versionId),
      ),
    );
  const storage = getStorage();
  const out: { shot: Screenshot; image: AiImageInput }[] = [];
  for (const shot of list) {
    const r = rows.find((x) => x.id === shot.versionId);
    if (!r || !r.mime.startsWith("image/")) continue;
    try {
      const data = await sharp(await storage.get(r.key))
        .rotate()
        .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      out.push({ shot, image: { mediaType: "image/jpeg", data } });
    } catch {
      // Imagem ilegível: fica de fora (a tela mostra quais capturas foram lidas).
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pedido ao modelo                                                    */
/* ------------------------------------------------------------------ */

const SYSTEM = [
  "Você é estrategista de marca e de Instagram de uma agência de marketing brasileira.",
  "Trabalhe SOMENTE com os dados enviados (cada um com fonte e data) e com as imagens anexadas, quando houver.",
  "Nunca invente números: seguidores, curtidas, alcance, engajamento, porcentagens, anos de mercado ou quantidade de clientes.",
  'Separe sempre o que foi observado (está nos dados ou nas imagens; cite a evidência), o que é avaliação sua ("hypothesis", a testar) e o que não dá para avaliar ("insufficient").',
  "Não atribua resultados a ações sem evidência. Não use dados privados nem faça suposições sobre pessoas.",
  "Responda em português do Brasil, exclusivamente com o JSON pedido.",
].join(" ");

const oneLine = (v: string, max = 400) => v.replace(/\s+/g, " ").trim().slice(0, max);
const day = (iso: string) => iso.slice(0, 10);
const from = (x: { source: SourceKind; collectedAt: string }) =>
  `(fonte: ${SOURCE_LABEL[x.source]}${x.source === "manual" ? ", não verificado" : ""}, em ${day(x.collectedAt)})`;

function describeInputs(i: DiagnosisInputs, o: { bioLimit: number; images: Screenshot[]; imagesNote: string }) {
  const p = i.profile;
  const field = (label: string, v: { value: string | number; source: SourceKind; collectedAt: string } | null) =>
    v
      ? `- ${label}: ${typeof v.value === "string" ? oneLine(v.value) : v.value} ${from(v)}`
      : `- ${label}: não informado`;
  const posts = i.posts;
  const lines = [
    `Perfil: @${i.handle}`,
    `Endereço do perfil: ${i.profileUrl}`,
    i.niche.niche ? `Nicho: ${oneLine(i.niche.niche, 200)}` : null,
    i.niche.market ? `Mercado: ${oneLine(i.niche.market, 200)}` : null,
    i.niche.region ? `Região: ${oneLine(i.niche.region, 200)}` : null,
    `Limite da bio: ${o.bioLimit} caracteres`,
    "",
    "Dados do perfil:",
    field("Nome de exibição", p.displayName),
    field("Categoria", p.category),
    p.bio
      ? `- Bio atual (${countChars(p.bio.value)} caracteres) ${from(p.bio)}: «${p.bio.value.replace(/\n/g, " / ")}»`
      : "- Bio atual: não informada",
    field("Link da bio", p.link),
    field("Seguidores", p.followers),
    p.following ? field("Seguindo", p.following) : null,
    p.postsCount ? field("Total de publicações", p.postsCount) : null,
    i.highlights
      ? `Destaques atuais: ${i.highlights.value.map((h) => oneLine(h, 60)).join(" | ")} ${from(i.highlights)}`
      : "Destaques atuais: (nenhum informado)",
    posts?.items.length ? `Publicações ${from(posts)}:` : "Publicações: nenhuma informada",
    ...(posts?.items ?? []).slice(0, 30).map((post, n) => {
      const fmt = post.format ? POST_FORMATS[post.format] : "formato não informado";
      const text = "caption" in post ? post.caption : post.text;
      const api = "likes" in post ? (post as ApiPost) : null;
      const metrics =
        api && (api.likes !== null || api.comments !== null)
          ? ` — curtidas: ${api.likes ?? "não informado"}, comentários: ${api.comments ?? "não informado"}${api.timestamp ? `, publicado em ${day(api.timestamp)}` : ""}`
          : "";
      return `  ${n + 1}. [${fmt}] ${oneLine(text || "(sem legenda)", 300)}${metrics}`;
    }),
    i.brand
      ? `Cadastro da marca do cliente (fonte: ${SOURCE_LABEL.client_record}): ${[
          i.brand.industry ? `segmento: ${oneLine(i.brand.industry, 120)}` : null,
          i.brand.audience ? `público: ${oneLine(i.brand.audience, 300)}` : null,
          i.brand.positioning ? `posicionamento: ${oneLine(i.brand.positioning, 300)}` : null,
          i.brand.toneOfVoice ? `tom de voz: ${oneLine(i.brand.toneOfVoice, 200)}` : null,
          i.brand.objectives ? `objetivos: ${oneLine(i.brand.objectives, 300)}` : null,
        ]
          .filter(Boolean)
          .join("; ")}`
      : "Cadastro da marca do cliente: não preenchido",
    i.goals ? `Objetivos informados pela equipe: ${oneLine(i.goals, 600)}` : null,
    i.notes ? `Observações da equipe: ${oneLine(i.notes, 800)}` : null,
    i.competitors.length
      ? `Concorrentes: ${i.competitors.map((c) => `@${c.handle}`).join(", ")}`
      : "Concorrentes: (nenhum cadastrado)",
    o.images.length
      ? `Capturas de tela anexadas, na ordem das imagens: ${o.images
          .map((sh, n) => `${n + 1}) ${SCREENSHOT_KINDS[sh.kind]} — ${oneLine(sh.name, 80)}`)
          .join("; ")}`
      : `Capturas de tela: não anexadas (${o.imagesNote})`,
    i.missing.length ? `Informações que faltam: ${i.missing.join("; ")}` : null,
  ];
  return lines.filter((x) => x !== null).join("\n");
}

const BIO_RULES = (limit: number) =>
  `Bio: avalie a bio atual (audit) pelos critérios: o que a marca faz, para quem, benefício ou diferencial, prova de confiança, chamada para ação, link e palavras-chave (assessment: ok, improve, missing ou not_evaluated). Crie exatamente 3 versões — style "direct" (direta e comercial), "strategic" (estratégica, orientada ao posicionamento) e "creative" (criativa e diferenciada) —, cada uma com no máximo ${limit} caracteres, objetivo, pontos fortes, chamada para ação e alertas (o que confirmar com o cliente). Não use números que não estejam nos dados e não prometa resultados.`;

const RECOMMENDATION_RULES =
  "Recomendações (até 12): area (bio, highlights, visual, content, niche, cta, profile), category (fix_now = corrigir agora, improve_soon = melhorar em breve, strategic = oportunidade estratégica, monitor = monitorar, insufficient = informação insuficiente), title, problem, evidence (o dado que sustenta), evidenceSource (de onde veio), basis, impact/effort/confidence (alto, medio, baixo), priority de 1 (mais urgente) a 5, nextAction e howToTest.";

/* JSON Schema (saída estruturada): todos os campos obrigatórios, sem campos extras. */
const str = { type: "string" };
const strArr = { type: "array", items: str };
const en = (keys: readonly string[]) => ({ type: "string", enum: [...keys] });
function obj(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
const BASIS_KEYS = ["observed", "hypothesis", "insufficient"] as const;
const LEVEL_KEYS = Object.keys(LEVEL3);
const findingSchema = obj({ text: str, basis: en(BASIS_KEYS), evidence: str });
const bioSchema = obj({
  audit: {
    type: "array",
    items: obj({ criterion: str, assessment: en(["ok", "improve", "missing", "not_evaluated"]), note: str }),
  },
  versions: {
    type: "array",
    items: obj({
      style: en(["direct", "strategic", "creative"]),
      text: str,
      objective: str,
      strengths: strArr,
      cta: str,
      warnings: strArr,
    }),
  },
});
const recommendationSchema = obj({
  area: en(Object.keys(RECOMMENDATION_AREAS)),
  category: en(Object.keys(RECOMMENDATION_CATEGORIES)),
  title: str,
  problem: str,
  evidence: str,
  evidenceSource: str,
  basis: en(BASIS_KEYS),
  impact: en(LEVEL_KEYS),
  effort: en(LEVEL_KEYS),
  priority: { type: "integer" },
  confidence: en(LEVEL_KEYS),
  nextAction: str,
  howToTest: str,
});
const DIAGNOSIS_SCHEMA = obj({
  summary: str,
  strengths: { type: "array", items: findingSchema },
  problems: { type: "array", items: findingSchema },
  opportunities: { type: "array", items: findingSchema },
  dimensions: {
    type: "array",
    items: obj({ key: str, score: { anyOf: [{ type: "integer" }, { type: "null" }] }, rationale: str, evidence: str }),
  },
  bio: bioSchema,
  highlights: obj({
    assessment: str,
    basis: en(BASIS_KEYS),
    recommended: {
      type: "array",
      items: obj({
        name: str,
        objective: str,
        order: { type: "integer" },
        storyIdeas: strArr,
        coverDirection: str,
        coverPrompt: str,
      }),
    },
  }),
  visual: obj({
    note: str,
    items: { type: "array", items: obj({ criterion: str, assessment: str, basis: en(BASIS_KEYS) }) },
  }),
  content: obj({
    categories: {
      type: "array",
      items: obj({ key: en(Object.keys(CONTENT_CATEGORIES)), presence: en(Object.keys(PRESENCE)), note: str }),
    },
    recommendations: { type: "array", items: obj({ idea: str, hypothesis: str, howToTest: str }) },
  }),
  recommendations: { type: "array", items: recommendationSchema },
  plan30: { type: "array", items: obj({ week: { type: "integer" }, focus: str, actions: strArr }) },
});
const NICHE_SCHEMA = obj({
  summary: str,
  facts: strArr,
  hypotheses: strArr,
  opportunities: strArr,
  competitors: {
    type: "array",
    items: obj({ handle: str, positioning: str, differences: str, basis: en(BASIS_KEYS) }),
  },
  recommendations: { type: "array", items: recommendationSchema },
});

/* ------------------------------------------------------------------ */
/* Leitura tolerante da resposta (campos fora do padrão são corrigidos) */
/* ------------------------------------------------------------------ */

const txt = (max: number) =>
  z
    .string()
    .catch("")
    .transform((v) => v.trim().slice(0, max));
function list<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((a) =>
      a
        .flatMap((x) => {
          const r = item.safeParse(x);
          return r.success ? [r.data as z.output<T>] : [];
        })
        .slice(0, max),
    );
}
const basisZ = z.enum(BASIS_KEYS).catch("hypothesis");
const levelZ = z.enum(["alto", "medio", "baixo"]).catch("medio");
const finding = z.object({ text: txt(600), basis: basisZ, evidence: txt(400) });
const bioZ = z
  .object({
    audit: list(
      z.object({
        criterion: txt(200),
        assessment: z.enum(["ok", "improve", "missing", "not_evaluated"]).catch("not_evaluated"),
        note: txt(400),
      }),
      10,
    ),
    versions: list(
      z.object({
        style: z.string().catch(""),
        text: txt(1000),
        objective: txt(300),
        strengths: list(z.string(), 6),
        cta: txt(200),
        warnings: list(z.string(), 6),
      }),
      6,
    ),
  })
  .catch({ audit: [], versions: [] });
const recommendationZ = z.object({
  area: z.enum(Object.keys(RECOMMENDATION_AREAS) as [keyof typeof RECOMMENDATION_AREAS]).catch("profile"),
  category: z.enum(Object.keys(RECOMMENDATION_CATEGORIES) as [keyof typeof RECOMMENDATION_CATEGORIES]).catch("monitor"),
  title: txt(200),
  problem: txt(800),
  evidence: txt(500),
  evidenceSource: txt(200),
  basis: basisZ,
  impact: levelZ,
  effort: levelZ,
  priority: z.coerce.number().int().min(1).max(5).catch(3),
  confidence: levelZ,
  nextAction: txt(500),
  howToTest: txt(500),
});
export const diagnosisResponse = z.object({
  summary: txt(1500),
  strengths: list(finding, 8),
  problems: list(finding, 8),
  opportunities: list(finding, 8),
  dimensions: list(
    z.object({ key: z.string(), score: z.number().nullable().catch(null), rationale: txt(800), evidence: txt(400) }),
    16,
  ),
  bio: bioZ,
  highlights: z
    .object({
      assessment: txt(800),
      basis: basisZ,
      recommended: list(
        z.object({
          name: txt(40),
          objective: txt(300),
          order: z.coerce.number().catch(0),
          storyIdeas: list(z.string(), 8),
          coverDirection: txt(300),
          coverPrompt: txt(500),
        }),
        8,
      ),
    })
    .catch({ assessment: "", basis: "insufficient", recommended: [] }),
  visual: z
    .object({ note: txt(600), items: list(z.object({ criterion: txt(200), assessment: txt(500), basis: basisZ }), 10) })
    .catch({ note: "", items: [] }),
  content: z
    .object({
      categories: list(
        z.object({
          key: z.string(),
          presence: z.enum(Object.keys(PRESENCE) as [keyof typeof PRESENCE]).catch("unknown"),
          note: txt(300),
        }),
        12,
      ),
      recommendations: list(z.object({ idea: txt(300), hypothesis: txt(400), howToTest: txt(400) }), 8),
    })
    .catch({ categories: [], recommendations: [] }),
  recommendations: list(recommendationZ, 15),
  plan30: list(
    z.object({ week: z.coerce.number().int().min(1).max(5).catch(1), focus: txt(200), actions: list(z.string(), 8) }),
    5,
  ),
});
export const bioResponse = bioZ;
export const nicheResponse = z.object({
  summary: txt(1500),
  facts: list(z.string(), 10),
  hypotheses: list(z.string(), 10),
  opportunities: list(z.string(), 10),
  competitors: list(z.object({ handle: txt(60), positioning: txt(500), differences: txt(600), basis: basisZ }), 10),
  recommendations: list(recommendationZ, 12),
});

/* ------------------------------------------------------------------ */
/* Regras do sistema (funções puras, testadas em tests/brand-radar.test.ts) */
/* ------------------------------------------------------------------ */

/** Números presentes nos dados de entrada (só esses podem aparecer nos textos da IA). */
export function inputNumbers(i: DiagnosisInputs, extra: (string | number)[] = []): Set<string> {
  const set = new Set<string>();
  const add = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return;
    for (const m of String(v).matchAll(/\d[\d.,]*/g)) set.add(m[0].replace(/[.,]/g, ""));
  };
  const p = i.profile;
  [
    p.displayName?.value,
    p.category?.value,
    p.bio?.value,
    p.link?.value,
    p.followers?.value,
    p.following?.value,
    p.postsCount?.value,
  ].forEach(add);
  (i.highlights?.value ?? []).forEach(add);
  for (const post of i.posts?.items ?? []) {
    add("caption" in post ? post.caption : post.text);
    if ("likes" in post) {
      add(post.likes);
      add(post.comments);
    }
  }
  if (i.brand) Object.values(i.brand).forEach((v) => add(v));
  [i.niche.niche, i.niche.market, i.niche.region, i.goals, i.notes].forEach(add);
  for (const c of i.competitors) [c.handle, c.notes, c.bio].forEach(add);
  extra.forEach(add);
  return set;
}

class Cleaner {
  removed = false;
  constructor(private allowed: Set<string>) {}
  text = (t: string) => {
    const r = stripUnsupportedNumbers(t, this.allowed);
    this.removed ||= r.removed;
    return r.text;
  };
  list = (a: string[]) => a.map(this.text).filter((x) => x.trim());
}

function cleanFindings(items: Finding[], c: Cleaner, counter: { downgraded: number }): Finding[] {
  return items
    .filter((f) => f.text)
    .map((f) => {
      const basis: Basis = f.basis === "observed" && !f.evidence ? "hypothesis" : f.basis;
      if (basis !== f.basis) counter.downgraded++;
      return { text: c.text(f.text), basis, evidence: c.text(f.evidence) };
    });
}

function cleanRecommendations(
  items: z.output<typeof recommendationZ>[],
  c: Cleaner,
  counter: { downgraded: number },
): RecommendationDraft[] {
  return items
    .filter((r) => r.title && r.problem)
    .map((r) => {
      const basis: Basis = r.basis === "observed" && !r.evidence ? "hypothesis" : r.basis;
      if (basis !== r.basis) counter.downgraded++;
      return {
        ...r,
        basis,
        title: c.text(r.title),
        problem: c.text(r.problem),
        evidence: c.text(r.evidence),
        evidenceSource: r.evidenceSource,
        nextAction: c.text(r.nextAction),
        howToTest: c.text(r.howToTest),
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

const STYLE_ORDER = ["direct", "strategic", "creative"] as const;

/** Três versões (uma por estilo), contagem refeita pelo sistema e números sem respaldo trocados por "[confirmar]". */
function cleanBio(
  raw: z.output<typeof bioZ>,
  inputs: DiagnosisInputs,
  bioLimit: number,
  allowed: Set<string>,
  notes: string[],
) {
  const current = inputs.profile.bio?.value ?? null;
  const pool = [...raw.versions.filter((v) => v.text)];
  const picked: typeof pool = [];
  for (const style of STYLE_ORDER) {
    const idx = pool.findIndex((v) => v.style === style);
    if (idx >= 0) picked.push({ ...pool.splice(idx, 1)[0]!, style });
  }
  for (const style of STYLE_ORDER) {
    if (picked.some((v) => v.style === style) || !pool.length) continue;
    picked.push({ ...pool.shift()!, style });
  }
  picked.sort((a, b) => STYLE_ORDER.indexOf(a.style as never) - STYLE_ORDER.indexOf(b.style as never));
  if (picked.length < 3) notes.push(`A IA devolveu ${picked.length} de 3 versões de bio pedidas.`);
  let numbers = false;
  const versions: BioVersionDraft[] = picked.map((v) => {
    const warnings = v.warnings.map((w) => stripUnsupportedNumbers(w, allowed).text);
    const r = stripUnsupportedNumbers(v.text, allowed);
    const text = r.text.replace(/\[número sem respaldo na fonte\]/g, "[confirmar]");
    if (r.removed) {
      numbers = true;
      warnings.unshift("Tinha um número que não consta nos dados (trocado por [confirmar]): confirme com o cliente.");
    }
    const chars = countChars(text);
    const overLimit = chars > bioLimit;
    if (overLimit) warnings.unshift(`Passa do limite de ${bioLimit} caracteres.`);
    return {
      style: v.style as BioVersionDraft["style"],
      text,
      objective: stripUnsupportedNumbers(v.objective, allowed).text,
      strengths: v.strengths.slice(0, 6),
      cta: v.cta,
      warnings,
      chars,
      overLimit,
    };
  });
  if (numbers) notes.push("Números sem respaldo nos dados foram retirados das versões de bio.");
  const audit = current
    ? raw.audit.filter((a) => a.criterion).map((a) => ({ ...a, note: stripUnsupportedNumbers(a.note, allowed).text }))
    : [
        {
          criterion: "Bio atual",
          assessment: "not_evaluated" as const,
          note: "A bio atual não foi informada: não dá para auditar.",
        },
      ];
  return { current, chars: current ? countChars(current) : null, limit: bioLimit, audit, versions };
}

export type RuleOptions = {
  bioLimit: number;
  weights: Record<DimensionKey, number>;
  /** As imagens foram de fato enviadas a um modelo que lê imagens. */
  vision: boolean;
  /** Por que as imagens não foram lidas (quando vision = false). */
  visionNote: string;
  demo: boolean;
};

/** Aplica as regras do sistema à resposta do diagnóstico completo. */
export function applyDiagnosisRules(raw: z.output<typeof diagnosisResponse>, inputs: DiagnosisInputs, o: RuleOptions) {
  const notes: string[] = [];
  const allowed = inputNumbers(inputs, [o.bioLimit]);
  const c = new Cleaner(allowed);
  const counter = { downgraded: 0 };
  const available = availableRequirements(inputs, o.vision);

  const completeness = completenessScore(inputs, o.bioLimit);
  const formats = formatsScore(inputs);
  const performance = performanceScore(inputs);
  const objective = { completeness, formats, performance };

  let discarded = 0;
  const dimensions: DimensionResult[] = DIMENSION_KEYS.map((key) => {
    const def = BRAND_DIMENSIONS[key];
    if (def.kind === "objective") {
      const r = objective[key as "completeness" | "formats" | "performance"];
      return {
        key,
        score: r.score,
        status: r.score === null ? "not_evaluated" : "objective",
        rationale: r.note,
        evidence: "",
      };
    }
    const ai = raw.dimensions.find((d) => d.key === key);
    const missing = (def.requires as readonly Requirement[]).filter((r) => !available.has(r));
    if (missing.length) {
      if (typeof ai?.score === "number") discarded++;
      return {
        key,
        score: null,
        status: "not_evaluated",
        rationale:
          key === "visual" && !o.vision
            ? `Não avaliada: ${o.visionNote}`
            : `Não avaliada: faltam ${missing.map((m) => REQUIREMENT_LABEL[m]).join(" e ")}.`,
        evidence: "",
      };
    }
    if (typeof ai?.score !== "number" || !Number.isFinite(ai.score)) {
      return { key, score: null, status: "not_evaluated", rationale: "A IA não avaliou esta dimensão.", evidence: "" };
    }
    return {
      key,
      score: Math.max(0, Math.min(100, Math.round(ai.score))),
      status: "ai",
      rationale: c.text(ai.rationale),
      evidence: c.text(ai.evidence),
    };
  });
  if (discarded) notes.push(`${discarded} nota(s) dada(s) pela IA sem os dados necessários foram descartadas.`);
  if (performance.score === null) notes.push("Desempenho não avaliado: sem métricas reais da conta conectada.");

  const highlightsKnown = available.has("highlights");
  const recommended: HighlightPlan[] = [...raw.highlights.recommended]
    .filter((h) => h.name)
    .sort((a, b) => (a.order || 99) - (b.order || 99))
    .map((h, n) => ({
      name: h.name,
      objective: c.text(h.objective),
      order: n + 1,
      storyIdeas: c.list(h.storyIdeas).slice(0, 8),
      coverDirection: c.text(h.coverDirection),
      coverPrompt: h.coverPrompt,
    }));

  const postsKnown = available.has("posts");
  let forcedUnknown = false;
  const categories = (Object.keys(CONTENT_CATEGORIES) as (keyof typeof CONTENT_CATEGORIES)[]).map((key) => {
    const found = raw.content.categories.find((x) => x.key === key);
    if (!postsKnown) {
      if (found && found.presence !== "unknown") forcedUnknown = true;
      return { key, presence: "unknown" as const, note: "Sem publicações informadas." };
    }
    return { key, presence: found?.presence ?? "unknown", note: c.text(found?.note ?? "") };
  });
  if (forcedUnknown)
    notes.push("Sem publicações informadas: as categorias de conteúdo ficaram como “não dá para avaliar”.");

  if (!o.vision && inputs.screenshots.length) notes.push(`Capturas de tela não analisadas: ${o.visionNote}`);
  const visual = o.vision
    ? {
        evaluated: true,
        note: c.text(raw.visual.note),
        items: raw.visual.items.filter((x) => x.criterion).map((x) => ({ ...x, assessment: c.text(x.assessment) })),
      }
    : { evaluated: false, note: o.visionNote, items: [] };

  const bio = cleanBio(raw.bio, inputs, o.bioLimit, allowed, notes);
  const recommendations = cleanRecommendations(raw.recommendations, c, counter);
  const result: DiagnosisResult = {
    demo: o.demo,
    summary: c.text(raw.summary),
    strengths: cleanFindings(raw.strengths, c, counter),
    problems: cleanFindings(raw.problems, c, counter),
    opportunities: cleanFindings(raw.opportunities, c, counter),
    dimensions,
    objective,
    bio,
    highlights: {
      current: inputs.highlights?.value ?? [],
      assessment: highlightsKnown ? c.text(raw.highlights.assessment) : "Os destaques atuais não foram informados.",
      basis: highlightsKnown
        ? raw.highlights.basis === "insufficient"
          ? "insufficient"
          : raw.highlights.basis
        : "insufficient",
      recommended,
    },
    visual,
    content: {
      categories,
      recommendations: raw.content.recommendations
        .filter((r) => r.idea)
        .map((r) => ({ idea: c.text(r.idea), hypothesis: c.text(r.hypothesis), howToTest: c.text(r.howToTest) })),
    },
    niche: null,
    plan30: [...raw.plan30]
      .filter((w) => w.focus)
      .sort((a, b) => a.week - b.week)
      .map((w) => ({ week: w.week, focus: c.text(w.focus), actions: c.list(w.actions) })),
    guardrails: notes,
  };
  if (counter.downgraded)
    notes.push(`${counter.downgraded} item(ns) marcados como “observado” sem evidência passaram a “avaliação da IA”.`);
  if (c.removed) notes.push("Números sem respaldo nos dados foram removidos dos textos da IA.");
  if (o.demo) notes.push("Modo demonstração: resultado de exemplo, sem análise real.");
  const overall = overallScore(dimensions, o.weights);
  return { result, recommendations, overall };
}

export function applyBioRules(
  raw: z.output<typeof bioZ>,
  inputs: DiagnosisInputs,
  o: { bioLimit: number; demo: boolean },
) {
  const notes: string[] = [];
  const allowed = inputNumbers(inputs, [o.bioLimit]);
  const bio = cleanBio(raw, inputs, o.bioLimit, allowed, notes);
  if (o.demo) notes.push("Modo demonstração: versões de exemplo, sem análise real.");
  const result: BioRewriteResult = {
    demo: o.demo,
    summary: `${bio.versions.length} versão(ões) de bio para @${inputs.handle}.`,
    bio,
    guardrails: notes,
  };
  return { result };
}

export function applyNicheRules(raw: z.output<typeof nicheResponse>, inputs: DiagnosisInputs, o: { demo: boolean }) {
  const notes: string[] = ["Sem coleta automática de outros perfis: a comparação usa só o que a equipe cadastrou."];
  const c = new Cleaner(inputNumbers(inputs));
  const counter = { downgraded: 0 };
  const known = new Map(inputs.competitors.map((x) => [x.handle.toLowerCase(), x]));
  const competitors = raw.competitors
    .map((x) => ({ ...x, handle: x.handle.replace(/^@/, "").toLowerCase() }))
    .filter((x) => known.has(x.handle));
  const dropped = raw.competitors.length - competitors.length;
  if (dropped) notes.push(`${dropped} perfil(is) citados pela IA fora da lista de concorrentes foram descartados.`);
  const result: NicheResult = {
    demo: o.demo,
    summary: c.text(raw.summary),
    niche: {
      summary: c.text(raw.summary),
      facts: c.list(raw.facts),
      hypotheses: c.list(raw.hypotheses),
      opportunities: c.list(raw.opportunities),
      competitors: competitors.map((x) => {
        const data = known.get(x.handle)!;
        // Sem nenhum dado cadastrado do concorrente, nada pode ser "observado".
        const basis: Basis =
          !data.bio && !data.notes ? "insufficient" : x.basis === "observed" && !data.bio ? "hypothesis" : x.basis;
        return { handle: x.handle, positioning: c.text(x.positioning), differences: c.text(x.differences), basis };
      }),
    },
    guardrails: notes,
  };
  const recommendations = cleanRecommendations(raw.recommendations, c, counter);
  if (counter.downgraded)
    notes.push(`${counter.downgraded} item(ns) marcados como “observado” sem evidência passaram a “avaliação da IA”.`);
  if (c.removed) notes.push("Números sem respaldo nos dados foram removidos dos textos da IA.");
  if (o.demo) notes.push("Modo demonstração: resultado de exemplo, sem análise real.");
  return { result, recommendations };
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

export const brandAiInput = z.object({
  profileId: z.uuid(),
  action: z.enum(Object.keys(BRAND_AI_ACTIONS) as [BrandAiAction, ...BrandAiAction[]]),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
  /** Enviar as capturas de tela ao modelo (só quando ele lê imagens). */
  useImages: z.boolean().default(true),
});

function visionDecision(prep: Prepared, inputs: DiagnosisInputs, useImages: boolean) {
  if (!inputs.screenshots.length) return { send: false, note: "nenhuma captura de tela enviada." };
  if (!useImages) return { send: false, note: "o envio das capturas para a IA foi desmarcado." };
  if (prep.demo) return { send: false, note: "o modelo de demonstração não lê imagens." };
  if (prep.model.caps.imageInput === "no") return { send: false, note: "o modelo escolhido não lê imagens." };
  return { send: true, note: "" };
}

/** Roda uma ação de IA do Radar e grava o resultado como um diagnóstico (linha do tempo). */
export async function runBrandAi(actor: Actor, raw: z.input<typeof brandAiInput>) {
  const data = brandAiInput.parse(raw);
  const action = BRAND_AI_ACTIONS[data.action];
  const kind: DiagnosisKind = action.kind;

  const ctx = await inOrg(actor, async (s) => {
    assertBrandManage(s);
    const { profile } = await loadProfile(s, data.profileId);
    if (profile.kind !== "own")
      throw new BrandAiError("Analise o perfil do cliente; concorrentes entram na comparação.");
    const prep = await prepare(s, data.selection);
    if (!prep.allowClientContext) {
      throw new BrandAiError(
        "O envio de dados de clientes para a IA está desativado em Configurações → Inteligência artificial. Ative essa opção ou use o modelo de demonstração.",
      );
    }
    const inputs = await buildInputs(s, profile.id);
    const settings = await radarSettings(s);
    const vision = visionDecision(prep, inputs, data.useImages);
    const loaded = vision.send && kind === "full" ? await loadImages(s, inputs.screenshots) : [];
    const visionNote =
      vision.send && kind === "full" && !loaded.length ? "não foi possível ler as capturas de tela." : vision.note;
    const [previous] =
      data.action === "reassess"
        ? await s.db
            .select({ result: brandRadarDiagnoses.result, createdAt: brandRadarDiagnoses.createdAt })
            .from(brandRadarDiagnoses)
            .where(and(eq(brandRadarDiagnoses.profileId, profile.id), eq(brandRadarDiagnoses.kind, "full")))
            .orderBy(desc(brandRadarDiagnoses.createdAt))
            .limit(1)
        : [];
    return { profile, prep, inputs, settings, images: loaded, visionNote, previous };
  });
  const { profile, prep, inputs, settings, images, previous } = ctx;
  const shots = images.map((x) => x.shot);
  const dataBlock = describeInputs(inputs, { bioLimit: settings.bioLimit, images: shots, imagesNote: ctx.visionNote });
  const vision = images.length > 0;
  const available = availableRequirements(inputs, vision);
  const aiDims = DIMENSION_KEYS.filter((k) => BRAND_DIMENSIONS[k].kind === "ai");
  const evaluable = aiDims.filter((k) =>
    (BRAND_DIMENSIONS[k].requires as readonly Requirement[]).every((r) => available.has(r)),
  );
  const blocked = aiDims.filter((k) => !evaluable.includes(k));

  if (kind === "full") {
    const prompt = [
      "Formato da resposta: brand_diagnosis",
      "Tarefa: diagnóstico estratégico do perfil do Instagram abaixo.",
      action.focus ? `Foco pedido: ${action.focus}` : null,
      previous
        ? `Diagnóstico anterior (${day(previous.createdAt.toISOString())}): ${oneLine((previous.result as DiagnosisResult).summary ?? "", 600)}`
        : null,
      "",
      dataBlock,
      "",
      `Dimensões que você pode avaliar: ${evaluable.join(", ") || "(nenhuma)"}`,
      ...evaluable.map((k) => `- ${k} — ${BRAND_DIMENSIONS[k].label}: ${BRAND_DIMENSIONS[k].criteria}`),
      `Dimensões sem dados suficientes (devolva score null): ${blocked.join(", ") || "(nenhuma)"}`,
      "As dimensões completeness, formats e performance são calculadas pelo sistema: não as inclua.",
      "",
      "Regras:",
      '1. strengths, problems e opportunities: até 6 de cada, com basis "observed" (cite a evidência), "hypothesis" ou "insufficient".',
      "2. Sem métricas reais, não opine sobre desempenho, alcance ou engajamento.",
      `3. ${BIO_RULES(settings.bioLimit)}`,
      "4. Destaques: avalie os atuais e recomende de 3 a 6 (nome curto, objetivo, ordem, ideias de Stories, direção da capa e um prompt de imagem para a capa, sem texto na imagem).",
      `5. Identidade visual: ${vision ? "avalie cores, tipografia, hierarquia, legibilidade e consistência só pelo que aparece nas imagens." : "sem imagens, devolva visual.items vazio e explique em visual.note que não dá para avaliar."}`,
      `6. Conteúdo: para cada categoria (${Object.keys(CONTENT_CATEGORIES).join(", ")}) diga presence (present, low, absent ou unknown) só pelas publicações informadas; sem publicações, use unknown. As ideias de conteúdo são hipóteses: diga como testar.`,
      `7. ${RECOMMENDATION_RULES}`,
      "8. plan30: 4 semanas, cada uma com foco e ações práticas.",
    ]
      .filter((x) => x !== null)
      .join("\n");
    const call = await callModel(actor, prep, {
      operation: "brand_diagnosis",
      confirmCost: data.confirmCost,
      system: SYSTEM,
      prompt,
      images: images.map((x) => x.image),
      schema: DIAGNOSIS_SCHEMA,
      parse: diagnosisResponse,
      clientId: profile.clientId,
      maxTokens: 9000,
    });
    const { result, recommendations, overall } = applyDiagnosisRules(call.data, inputs, {
      bioLimit: settings.bioLimit,
      weights: settings.weights,
      vision,
      visionNote: ctx.visionNote,
      demo: prep.demo,
    });
    if (vision && prep.model.caps.imageInput === "unknown") {
      result.guardrails.push(
        "O provedor não confirma a leitura de imagens deste modelo: se a avaliação visual parecer genérica, refaça com um modelo de visão confirmada.",
      );
    }
    return persist(actor, call, {
      kind,
      profile,
      inputs: { ...inputs, screenshots: inputs.screenshots },
      result,
      overall,
      weights: settings.weights,
      recommendations,
      bios: result.bio?.versions ?? [],
      prep,
      title: `${action.label}: @${profile.handle}`,
      action: data.action,
      imagesSent: shots.map((x) => x.fileId),
    });
  }

  if (kind === "bio") {
    const prompt = [
      "Formato da resposta: brand_bio",
      "Tarefa: auditar a bio atual e propor 3 novas versões.",
      "",
      dataBlock,
      "",
      BIO_RULES(settings.bioLimit),
    ].join("\n");
    const call = await callModel(actor, prep, {
      operation: "brand_bio",
      confirmCost: data.confirmCost,
      system: SYSTEM,
      prompt,
      images: [],
      schema: bioSchema,
      parse: bioResponse,
      clientId: profile.clientId,
      maxTokens: 3000,
    });
    const { result } = applyBioRules(call.data, inputs, { bioLimit: settings.bioLimit, demo: prep.demo });
    return persist(actor, call, {
      kind,
      profile,
      inputs,
      result,
      overall: null,
      weights: settings.weights,
      recommendations: [],
      bios: result.bio.versions,
      prep,
      title: `${action.label}: @${profile.handle}`,
      action: data.action,
      imagesSent: [],
    });
  }

  const competitorsBlock = inputs.competitors.length
    ? inputs.competitors.map(
        (c) =>
          `  - @${c.handle}: ${c.bio ? `bio informada pela equipe: «${oneLine(c.bio, 300)}»` : "bio não informada"}${c.notes ? `; observações da equipe: ${oneLine(c.notes, 400)}` : ""}`,
      )
    : [];
  const prompt = [
    "Formato da resposta: brand_niche",
    `Tarefa: ${action.focus}.`,
    "",
    dataBlock,
    ...(competitorsBlock.length ? ["Dados dos concorrentes (informados pela equipe):", ...competitorsBlock] : []),
    "",
    "Regras:",
    "1. facts: só o que está nos dados acima (diga de onde veio). hypotheses: suas interpretações, a testar. opportunities: espaços que a marca pode ocupar.",
    "2. competitors: só os perfis da lista de concorrentes; positioning e differences com basis. Sem dados de um concorrente, use basis insufficient.",
    "3. Não use dados privados, não presuma números de seguidores ou engajamento de ninguém.",
    `4. ${RECOMMENDATION_RULES}`,
  ].join("\n");
  const call = await callModel(actor, prep, {
    operation: "brand_niche",
    confirmCost: data.confirmCost,
    system: SYSTEM,
    prompt,
    images: [],
    schema: NICHE_SCHEMA,
    parse: nicheResponse,
    clientId: profile.clientId,
    maxTokens: 5000,
  });
  const { result, recommendations } = applyNicheRules(call.data, inputs, { demo: prep.demo });
  return persist(actor, call, {
    kind,
    profile,
    inputs,
    result,
    overall: null,
    weights: settings.weights,
    recommendations,
    bios: [],
    prep,
    title: `${action.label}: @${profile.handle}`,
    action: data.action,
    imagesSent: [],
  });
}

async function persist(
  actor: Actor,
  call: Awaited<ReturnType<typeof callModel>>,
  o: {
    kind: DiagnosisKind;
    profile: { id: string; clientId: string; handle: string };
    inputs: DiagnosisInputs;
    result: DiagnosisResult | BioRewriteResult | NicheResult;
    overall: { score: number | null; evaluatedWeight: number } | null;
    weights: Record<DimensionKey, number>;
    recommendations: RecommendationDraft[];
    bios: BioVersionDraft[];
    prep: Prepared;
    title: string;
    action: BrandAiAction;
    imagesSent: string[];
  },
) {
  return inOrg(actor, async (s) => {
    const generationId = await recordSuccess(s, call, {
      title: o.title,
      input: { profileId: o.profile.id, action: o.action, imagesSent: o.imagesSent },
      clientId: o.profile.clientId,
    });
    const [row] = await s.db
      .insert(brandRadarDiagnoses)
      .values({
        organizationId: s.actor.orgId,
        clientId: o.profile.clientId,
        profileId: o.profile.id,
        kind: o.kind,
        methodologyVersion: BRAND_METHODOLOGY_VERSION,
        weights: o.weights,
        inputs: o.inputs,
        result: o.result,
        overallScore: o.overall?.score ?? null,
        evaluatedWeight: o.overall?.evaluatedWeight ?? null,
        provider: o.prep.providerId,
        model: call.model,
        demo: o.prep.demo,
        generationId,
        createdByUserId: s.actor.userId,
      })
      .returning({ id: brandRadarDiagnoses.id });
    const diagnosisId = row!.id;
    if (o.recommendations.length) {
      await s.db.insert(brandRadarRecommendations).values(
        o.recommendations.map((r) => ({
          organizationId: s.actor.orgId,
          clientId: o.profile.clientId,
          profileId: o.profile.id,
          diagnosisId,
          area: r.area,
          category: r.category,
          title: r.title,
          problem: r.problem,
          evidence: r.evidence,
          evidenceSource: r.evidenceSource,
          basis: r.basis,
          impact: r.impact,
          effort: r.effort,
          priority: r.priority,
          confidence: r.confidence,
          nextAction: r.nextAction,
          howToTest: r.howToTest || null,
        })),
      );
    }
    if (o.bios.length) {
      await s.db.insert(brandRadarBioVersions).values(
        o.bios.map((b) => ({
          organizationId: s.actor.orgId,
          clientId: o.profile.clientId,
          profileId: o.profile.id,
          diagnosisId,
          style: b.style,
          text: b.text,
          objective: b.objective,
          strengths: b.strengths,
          cta: b.cta,
          warnings: b.warnings,
          createdByUserId: s.actor.userId,
        })),
      );
    }
    await s.db.update(brandRadarProfiles).set({ updatedAt: new Date() }).where(eq(brandRadarProfiles.id, o.profile.id));
    await recordActivity(s, {
      action: "analyzed",
      entityType: "brand_radar_profile",
      entityId: o.profile.id,
      summary: `Radar de Marca: ${o.title}${o.prep.demo ? " (demonstração)" : ""}`,
      event: false,
    });
    return {
      diagnosisId,
      kind: o.kind,
      demo: o.prep.demo,
      model: call.model,
      provider: o.prep.providerId,
      score: o.overall?.score ?? null,
      recommendations: o.recommendations.length,
      bios: o.bios.length,
      styles: o.bios.map((b) => BIO_STYLES[b.style]),
    };
  });
}
