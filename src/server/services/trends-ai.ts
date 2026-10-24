import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { CONTENT_FORMAT_KEYS, CONTENT_FORMATS, type ContentFormat } from "@/lib/content";
import { todayISO } from "@/lib/format";
import { LEVELS, LIFESPANS, RISK_LEVELS, TREND_NICHES, TREND_PLATFORMS, TREND_TYPES } from "@/lib/trends";
import { assertCan, assertClientAccess, assertInternal, inOrg, type Actor, type Scope } from "@/server/authz";
import { AiProviderError } from "@/server/ai/types";
import {
  brandProfiles,
  clients,
  clientServices,
  trendAnalyses,
  trendObservations,
  trends,
  type TrendMetric,
} from "@/server/db/schema";
import { AppError, NotFoundError, ValidationError } from "@/server/errors";
import { assertCanGenerate, CostConfirmationError, estimateMaxCostMicros, recordUsage, saveGeneration } from "./ai";
import { aiSelectionInput, resolveSelection } from "./ai-models";
import { growthEvidence } from "./trends";

/*
 * IA do Radar de Tendências. A IA só recebe os dados observados (o que a
 * fonte devolveu) e devolve INFERÊNCIAS, gravadas à parte em trend_analyses.
 * Regras do sistema aplicadas depois da resposta (registradas em
 * `guardrails`):
 *  - números que não constam nos dados da fonte são removidos do texto;
 *  - "em crescimento" exige evidência medida entre coletas; sem ela vira "emergente";
 *  - datas do calendário são sempre sazonais;
 *  - itens sem nenhum indicador não passam de confiança média;
 *  - tema com risco de reputação alto nunca é recomendado a um cliente;
 *  - identificadores que não estavam na lista enviada são descartados.
 * Toda chamada é registrada (uso e histórico); falha nunca é tratada como sucesso.
 * A rede do provedor é chamada FORA de transações do banco.
 */

export class TrendAiError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "TrendAiError";
  }
}

type ObservedTrend = {
  id: string;
  title: string;
  summary: string | null;
  platform: string;
  niche: string | null;
  region: string | null;
  url: string | null;
  publishedAt: Date | null;
  eventDate: string | null;
  lastSeenAt: Date;
  metrics: TrendMetric[];
  related: { title: string; source: string | null }[];
  growth: ReturnType<typeof growthEvidence>;
};

async function loadObserved(s: Scope, ids: string[]): Promise<ObservedTrend[]> {
  if (!ids.length) return [];
  const rows = await s.db.select().from(trends).where(inArray(trends.id, ids));
  const obs = await s.db
    .select({
      trendId: trendObservations.trendId,
      observedOn: trendObservations.observedOn,
      rank: trendObservations.rank,
      metrics: trendObservations.metrics,
    })
    .from(trendObservations)
    .where(inArray(trendObservations.trendId, ids))
    .orderBy(asc(trendObservations.trendId), desc(trendObservations.observedOn));
  const byTrend = new Map<string, typeof obs>();
  for (const o of obs) {
    const list = byTrend.get(o.trendId) ?? [];
    if (list.length < 2) list.push(o);
    byTrend.set(o.trendId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    platform: r.platform,
    niche: r.niche,
    region: r.region,
    url: r.url,
    publishedAt: r.publishedAt,
    eventDate: r.eventDate,
    lastSeenAt: r.lastSeenAt,
    metrics: r.metrics,
    related: r.related.map((x) => ({ title: x.title, source: x.source })),
    growth: growthEvidence(byTrend.get(r.id) ?? []),
  }));
}

/** Bloco de dados observados enviado ao modelo (e lido pela demonstração local). */
function describeObserved(t: ObservedTrend) {
  return [
    `- id: ${t.id}`,
    `  assunto: ${t.title}`,
    `  plataforma: ${t.platform} (${(TREND_PLATFORMS as Record<string, string>)[t.platform] ?? t.platform})`,
    t.summary ? `  resumo da fonte: ${t.summary.slice(0, 300)}` : null,
    t.niche ? `  nicho informado: ${t.niche}` : null,
    t.region ? `  mercado: ${t.region}` : null,
    t.eventDate ? `  data do evento: ${t.eventDate}` : null,
    t.publishedAt ? `  publicado em: ${t.publishedAt.toISOString().slice(0, 10)}` : null,
    `  visto pela última vez: ${t.lastSeenAt.toISOString().slice(0, 10)}`,
    t.metrics.length
      ? `  indicadores da fonte: ${t.metrics.map((m) => `${m.label} = ${m.value}${m.asOf ? ` (em ${m.asOf})` : ""}`).join("; ")}`
      : "  indicadores da fonte: nenhum (a fonte não informa números)",
    t.growth.notes.length
      ? `  evidência entre coletas: ${t.growth.notes.join(" ")}`
      : "  evidência entre coletas: nenhuma medida",
    t.related.length
      ? `  notícias relacionadas: ${t.related
          .slice(0, 3)
          .map((r) => r.title)
          .join(" | ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Regras de proteção                                                  */
/* ------------------------------------------------------------------ */

/** Números presentes nos dados observados (só esses podem aparecer nos textos da IA). */
export function allowedNumbers(items: ObservedTrend[]): Set<string> {
  const set = new Set<string>();
  const add = (s: string | null | undefined) => {
    for (const m of (s ?? "").matchAll(/\d[\d.,]*/g)) set.add(m[0].replace(/[.,]/g, ""));
  };
  for (const t of items) {
    add(t.title);
    add(t.summary);
    add(t.eventDate);
    for (const m of t.metrics) {
      add(m.value);
      add(m.asOf);
      if (m.numeric != null) set.add(String(m.numeric));
    }
    for (const n of t.growth.notes) add(n);
    for (const r of t.related) add(r.title);
  }
  return set;
}

/** Remove números sem respaldo nos dados da fonte (contagens pequenas, como "3 ideias", ficam). */
export function stripUnsupportedNumbers(text: string, allowed: Set<string>): { text: string; removed: boolean } {
  let removed = false;
  const out = text.replace(/\d[\d.,]*\s*(%|mil|milhões|milhão|k\b|x\b)?/gi, (match, unit: string | undefined) => {
    const digits = match.replace(/[^\d]/g, "");
    const small = !unit && Number(digits) <= 10;
    if (small || allowed.has(digits)) return match;
    removed = true;
    return "[número sem respaldo na fonte]";
  });
  return { text: out, removed };
}

function cleanTexts<T extends Record<string, unknown>>(
  obj: T,
  allowed: Set<string>,
  keys: (keyof T)[],
  notes: string[],
) {
  let removed = false;
  const out = { ...obj };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "string") {
      const r = stripUnsupportedNumbers(v, allowed);
      removed ||= r.removed;
      (out as Record<string, unknown>)[k as string] = r.text;
    } else if (Array.isArray(v)) {
      (out as Record<string, unknown>)[k as string] = v.map((x) => {
        if (typeof x !== "string") return x;
        const r = stripUnsupportedNumbers(x, allowed);
        removed ||= r.removed;
        return r.text;
      });
    }
  }
  if (removed) notes.push("Números sem respaldo nos dados da fonte foram removidos do texto da IA.");
  return out;
}

const LEVEL_ORDER = ["baixa", "media", "alta"];

/* ------------------------------------------------------------------ */
/* Execução estruturada (prepara → chama o provedor → grava)           */
/* ------------------------------------------------------------------ */

type Prepared = {
  provider: ReturnType<NonNullable<Awaited<ReturnType<typeof resolveSelection>>["def"]["text"]>>;
  providerId: string;
  model: Awaited<ReturnType<typeof resolveSelection>>["model"];
  source: string;
  demo: boolean;
  allowClientContext: boolean;
  confirmAboveMicros: number;
};

async function prepare(s: Scope, task: "trend_analysis" | "copy", selection: unknown): Promise<Prepared> {
  const settings = await assertCanGenerate(s);
  const resolved = await resolveSelection(s, {
    module: "trends",
    task,
    selection: aiSelectionInput.parse(selection ?? {}),
  });
  const def = resolved.def;
  if (!def.text) throw new TrendAiError(`${def.label} não gera texto. Escolha um modelo de texto.`);
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
    schema: Record<string, unknown>;
    parse: z.ZodType<T>;
    clientId: string | null;
    maxTokens: number;
    confirmCost?: boolean;
  },
) {
  // Mesma política do Assistente: acima do limite da organização, pede confirmação antes de chamar.
  const maxTokens = Math.min(req.maxTokens, prep.model.maxOutputTokens ?? req.maxTokens);
  const estimate = estimateMaxCostMicros(prep.model, req.system.length + req.prompt.length, maxTokens);
  if (prep.confirmAboveMicros > 0 && estimate !== null && estimate > prep.confirmAboveMicros && !req.confirmCost) {
    throw new CostConfirmationError(estimate);
  }
  const started = Date.now();
  const usage = {
    provider: prep.providerId,
    model: prep.model.id,
    operation: req.operation,
    module: "trends",
    task: req.operation === "trend_content" ? "copy" : "trend_analysis",
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
    const message = err instanceof AiProviderError ? err.message : "Falha ao consultar a IA. Tente novamente.";
    if (!(err instanceof AiProviderError)) console.error("[tendências] erro na IA", err);
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
    throw new TrendAiError(message);
  }
}

async function recordSuccess(
  s: Scope,
  call: Awaited<ReturnType<typeof callModel>>,
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

const SYSTEM = [
  "Você é um analista de tendências de uma agência de marketing brasileira.",
  "Trabalhe SOMENTE com os dados observados enviados. Nunca invente números de visualizações, buscas, engajamento, crescimento ou porcentagens.",
  "Se a fonte não traz números, diga que não há indicador. Separe o que é dado da fonte do que é a sua interpretação.",
  "Uma notícia isolada não torna um assunto viral. Seja prudente com temas sensíveis (saúde, tragédias, política, religião, crianças).",
  "Responda em português do Brasil, exclusivamente com o JSON pedido.",
].join(" ");

/* ------------------------------------------------------------------ */
/* Classificação geral                                                 */
/* ------------------------------------------------------------------ */

const NICHE_KEYS = Object.keys(TREND_NICHES) as [string, ...string[]];
const enumOf = (o: Record<string, string>) => Object.keys(o) as [string, ...string[]];

const classificationItem = z.object({
  trendId: z.string(),
  type: z.enum(enumOf(TREND_TYPES)),
  relevance: z.enum(enumOf(LEVELS)),
  velocity: z.string().max(400),
  niche: z.enum(NICHE_KEYS),
  nicheFit: z.string().max(400),
  audienceInterest: z.enum(enumOf(LEVELS)),
  saturation: z.string().max(400),
  reputationRisk: z.enum(enumOf(RISK_LEVELS)),
  sensitivity: z.enum(enumOf(LEVELS)),
  lifespan: z.enum(enumOf(LIFESPANS)),
  confidence: z.enum(enumOf(LEVELS)),
  angles: z.array(z.string().max(300)).max(6),
  avoid: z.array(z.string().max(300)).max(6),
  rationale: z.string().max(1500),
});
const classificationResponse = z.object({ items: z.array(classificationItem).max(20) });

const str = { type: "string" };
const strArr = { type: "array", items: { type: "string" } };
const en = (o: Record<string, string>) => ({ type: "string", enum: Object.keys(o) });

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          trendId: str,
          type: en(TREND_TYPES),
          relevance: en(LEVELS),
          velocity: str,
          niche: { type: "string", enum: NICHE_KEYS },
          nicheFit: str,
          audienceInterest: en(LEVELS),
          saturation: str,
          reputationRisk: en(RISK_LEVELS),
          sensitivity: en(LEVELS),
          lifespan: en(LIFESPANS),
          confidence: en(LEVELS),
          angles: strArr,
          avoid: strArr,
          rationale: str,
        },
        required: [
          "trendId",
          "type",
          "relevance",
          "velocity",
          "niche",
          "nicheFit",
          "audienceInterest",
          "saturation",
          "reputationRisk",
          "sensitivity",
          "lifespan",
          "confidence",
          "angles",
          "avoid",
          "rationale",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export const classifyInput = z.object({
  trendIds: z.array(z.uuid()).min(1, "Selecione ao menos uma tendência.").max(12, "Classifique até 12 por vez."),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

/** Aplica as regras do sistema a um item classificado. */
export function applyClassificationRules(
  item: z.infer<typeof classificationItem>,
  observed: ObservedTrend,
  allowed: Set<string>,
) {
  const notes: string[] = [];
  let out = cleanTexts(item, allowed, ["velocity", "nicheFit", "saturation", "rationale", "angles", "avoid"], notes);
  if (observed.platform === "calendar" && out.type !== "sazonal") {
    out = { ...out, type: "sazonal" };
    notes.push("Data do calendário: classificada como sazonal.");
  }
  if (out.type === "crescimento" && observed.growth.growing !== true) {
    out = {
      ...out,
      type: "emergente",
      velocity: "Não mensurável com os dados disponíveis (sem comparação entre coletas).",
    };
    notes.push('"Em crescimento" exige evidência medida entre coletas; sem ela, o assunto aparece como emergente.');
  }
  if (!observed.metrics.length && LEVEL_ORDER.indexOf(out.confidence) > 1) {
    out = { ...out, confidence: "media" };
    notes.push("Sem indicadores na fonte: confiança limitada a média.");
  }
  return { item: out, notes };
}

export async function classifyTrends(actor: Actor, raw: z.input<typeof classifyInput>) {
  const data = classifyInput.parse(raw);
  const { prep, observed } = await inOrg(actor, async (s) => {
    assertInternal(s.actor);
    assertCan(s.actor, "trends.read");
    const prep = await prepare(s, "trend_analysis", data.selection);
    const observed = await loadObserved(s, data.trendIds);
    if (!observed.length) throw new NotFoundError("Tendências não encontradas.");
    return { prep, observed };
  });
  const prompt = [
    "Formato da resposta: trend_classification",
    'Classifique cada assunto abaixo. Para cada um devolva: tipo (emergente, crescimento, recorrente ou sazonal), relevância, velocidade (use "não mensurável" se não houver comparação entre coletas), nicho mais provável, relação com o nicho, interesse provável do público, saturação (só com evidência; senão "sem evidência de saturação"), risco de reputação, sensibilidade, tempo provável de relevância, confiança, até 4 ângulos de conteúdo, o que evitar e uma justificativa curta que deixe claro o que é dado da fonte e o que é interpretação.',
    "",
    "Dados observados:",
    ...observed.map(describeObserved),
  ].join("\n");
  const call = await callModel(actor, prep, {
    operation: "trend_classification",
    confirmCost: data.confirmCost,
    system: SYSTEM,
    prompt,
    schema: CLASSIFICATION_SCHEMA,
    parse: classificationResponse,
    clientId: null,
    maxTokens: 6000,
  });
  const byId = new Map(observed.map((o) => [o.id, o]));
  const allowed = allowedNumbers(observed);
  const valid = call.data.items.filter((i) => byId.has(i.trendId));
  const dropped = call.data.items.length - valid.length;
  return inOrg(actor, async (s) => {
    const generationId = await recordSuccess(s, call, {
      title: `Classificação de ${observed.length} tendência(s)`,
      input: { trendIds: data.trendIds },
      clientId: null,
    });
    const saved: string[] = [];
    for (const raw of valid) {
      const { item, notes } = applyClassificationRules(raw, byId.get(raw.trendId)!, allowed);
      if (dropped) notes.push(`${dropped} item(ns) da resposta citavam assuntos fora da lista e foram descartados.`);
      const [row] = await s.db
        .insert(trendAnalyses)
        .values({
          organizationId: s.actor.orgId,
          trendId: item.trendId,
          kind: "classification",
          trendType: item.type,
          relevance: item.relevance,
          velocity: item.velocity,
          nicheFit: item.nicheFit,
          audienceInterest: item.audienceInterest,
          saturation: item.saturation,
          reputationRisk: item.reputationRisk,
          sensitivity: item.sensitivity,
          lifespan: item.lifespan,
          confidence: item.confidence,
          suggestedNiche: item.niche,
          angles: item.angles.slice(0, 6),
          avoid: item.avoid.slice(0, 6),
          rationale: item.rationale,
          guardrails: notes,
          provider: prep.providerId,
          model: call.model,
          demo: prep.demo,
          generationId,
          createdByUserId: s.actor.userId,
        })
        .returning({ id: trendAnalyses.id });
      saved.push(row!.id);
    }
    return { classified: saved.length, missing: observed.length - saved.length, demo: prep.demo, model: call.model };
  });
}

/* ------------------------------------------------------------------ */
/* Adequação à marca de um cliente                                     */
/* ------------------------------------------------------------------ */

const fitItem = z.object({
  trendId: z.string(),
  recommended: z.boolean(),
  fit: z.string().max(1200),
  angles: z.array(z.string().max(300)).max(6),
  avoid: z.array(z.string().max(300)).max(6),
  reputationRisk: z.enum(enumOf(RISK_LEVELS)),
  confidence: z.enum(enumOf(LEVELS)),
});
const fitResponse = z.object({ recommendations: z.array(fitItem).max(30), notes: z.string().max(2000) });

const FIT_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          trendId: str,
          recommended: { type: "boolean" },
          fit: str,
          angles: strArr,
          avoid: strArr,
          reputationRisk: en(RISK_LEVELS),
          confidence: en(LEVELS),
        },
        required: ["trendId", "recommended", "fit", "angles", "avoid", "reputationRisk", "confidence"],
        additionalProperties: false,
      },
    },
    notes: str,
  },
  required: ["recommendations", "notes"],
  additionalProperties: false,
};

export const clientFitInput = z.object({
  clientId: z.uuid(),
  period: z.enum(["7d", "30d"]).default("7d"),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

async function brandContext(s: Scope, clientId: string) {
  const [row] = await s.db
    .select({ client: clients, brand: brandProfiles })
    .from(clients)
    .leftJoin(brandProfiles, eq(brandProfiles.clientId, clients.id))
    .where(eq(clients.id, clientId));
  if (!row) throw new NotFoundError("Cliente não encontrado.");
  const services = await s.db
    .select({ name: clientServices.name })
    .from(clientServices)
    .where(and(eq(clientServices.clientId, clientId), eq(clientServices.status, "active")));
  const b = row.brand;
  return {
    name: row.client.name,
    text: [
      `Marca: ${row.client.name}`,
      row.client.industry ? `Segmento: ${row.client.industry}` : null,
      row.client.address ? `Localização: ${row.client.address}` : null,
      b?.audience ? `Público-alvo: ${b.audience}` : null,
      b?.toneOfVoice ? `Tom de voz: ${b.toneOfVoice}` : null,
      b?.positioning ? `Posicionamento: ${b.positioning}` : null,
      b?.objectives ? `Objetivos: ${b.objectives}` : null,
      services.length ? `Produtos e serviços: ${services.map((x) => x.name).join(", ")}` : null,
      b?.keywords?.length ? `Palavras-chave: ${b.keywords.join(", ")}` : null,
      b?.avoid ? `Restrições (evitar): ${b.avoid}` : null,
      b?.guidelines ? `Diretrizes: ${b.guidelines.slice(0, 800)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function clientFit(actor: Actor, raw: z.input<typeof clientFitInput>) {
  const data = clientFitInput.parse(raw);
  const { prep, observed, brand } = await inOrg(actor, async (s) => {
    assertInternal(s.actor);
    assertCan(s.actor, "trends.read");
    await assertClientAccess(s, data.clientId);
    const prep = await prepare(s, "trend_analysis", data.selection);
    if (!prep.allowClientContext) {
      throw new ValidationError(
        "A organização não autorizou enviar dados de clientes para a IA. Libere em Configurações › Inteligência artificial para analisar tendências por marca.",
      );
    }
    const today = todayISO();
    const days = data.period === "30d" ? 30 : 7;
    const since = new Date(Date.parse(`${today}T00:00:00-03:00`) - (days - 1) * 86_400_000);
    const ids = await s.db
      .select({ id: trends.id })
      .from(trends)
      .where(
        or(
          and(sql`${trends.platform} <> 'calendar'`, gte(trends.lastSeenAt, since)),
          and(
            sql`${trends.platform} = 'calendar'`,
            gte(trends.eventDate, today),
            lte(
              trends.eventDate,
              new Date(Date.parse(`${today}T12:00:00Z`) + 45 * 86_400_000).toISOString().slice(0, 10),
            ),
          ),
        ),
      )
      .orderBy(desc(trends.lastSeenAt))
      .limit(40);
    if (!ids.length)
      throw new ValidationError("Não há tendências coletadas neste período. Atualize as fontes primeiro.");
    const observed = await loadObserved(
      s,
      ids.map((r) => r.id),
    );
    return { prep, observed, brand: await brandContext(s, data.clientId) };
  });
  const prompt = [
    "Formato da resposta: trend_client_fit",
    `Pergunta: quais tendências ${data.period === "30d" ? "dos últimos 30 dias" : "desta semana"} fazem sentido para esta marca?`,
    "Para cada assunto que valha a pena comentar, diga se é recomendado, por que combina (ou não) com a marca, ângulos de conteúdo específicos, o que evitar, o risco de reputação e a confiança. Não recomende temas incompatíveis com o posicionamento, de risco alto ou sensíveis demais para a marca. Inclua os não recomendados mais tentadores, explicando o motivo.",
    "",
    "Perfil da marca:",
    brand.text,
    "",
    "Dados observados:",
    ...observed.map(describeObserved),
  ].join("\n");
  const call = await callModel(actor, prep, {
    operation: "trend_client_fit",
    confirmCost: data.confirmCost,
    system: SYSTEM,
    prompt,
    schema: FIT_SCHEMA,
    parse: fitResponse,
    clientId: data.clientId,
    maxTokens: 6000,
  });
  const byId = new Map(observed.map((o) => [o.id, o]));
  const allowed = allowedNumbers(observed);
  const valid = call.data.recommendations.filter((r) => byId.has(r.trendId));
  return inOrg(actor, async (s) => {
    const generationId = await recordSuccess(s, call, {
      title: `Tendências para ${brand.name}`,
      input: { clientId: data.clientId, period: data.period },
      clientId: data.clientId,
    });
    const results: {
      analysisId: string;
      trendId: string;
      title: string;
      recommended: boolean;
      fit: string;
      angles: string[];
      avoid: string[];
      reputationRisk: string;
      confidence: string;
      guardrails: string[];
    }[] = [];
    for (const raw of valid) {
      const notes: string[] = [];
      const r = cleanTexts(raw, allowed, ["fit", "angles", "avoid"], notes);
      let recommended = r.recommended;
      if (recommended && r.reputationRisk === "alto") {
        recommended = false;
        notes.push("Risco de reputação alto: o sistema não recomenda este tema para a marca.");
      }
      const [row] = await s.db
        .insert(trendAnalyses)
        .values({
          organizationId: s.actor.orgId,
          trendId: r.trendId,
          clientId: data.clientId,
          kind: "client_fit",
          brandFit: r.fit,
          reputationRisk: r.reputationRisk,
          confidence: r.confidence,
          recommended,
          angles: r.angles.slice(0, 6),
          avoid: r.avoid.slice(0, 6),
          rationale: r.fit,
          guardrails: notes,
          provider: prep.providerId,
          model: call.model,
          demo: prep.demo,
          generationId,
          createdByUserId: s.actor.userId,
        })
        .returning({ id: trendAnalyses.id });
      results.push({
        analysisId: row!.id,
        trendId: r.trendId,
        title: byId.get(r.trendId)!.title,
        recommended,
        fit: r.fit,
        angles: r.angles,
        avoid: r.avoid,
        reputationRisk: r.reputationRisk,
        confidence: r.confidence,
        guardrails: notes,
      });
    }
    const notes = stripUnsupportedNumbers(call.data.notes, allowed).text;
    return {
      clientName: brand.name,
      recommended: results.filter((r) => r.recommended),
      notRecommended: results.filter((r) => !r.recommended),
      notes,
      discarded: call.data.recommendations.length - valid.length,
      demo: prep.demo,
      model: call.model,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Pacote de conteúdo a partir de uma tendência (prévia editável)      */
/* ------------------------------------------------------------------ */

const contentPackResponse = z.object({
  title: z.string().max(200),
  concept: z.string().max(4000),
  strategy: z.string().max(4000),
  copy: z.string().max(4000),
  caption: z.string().max(4000),
  cta: z.string().max(300),
  script: z.string().max(8000),
  visualDirection: z.string().max(4000),
  imagePrompt: z.string().max(4000),
  hashtags: z.array(z.string().max(60)).max(15),
  slides: z.array(z.object({ title: z.string().max(200), text: z.string().max(1200) })).max(10),
});
export type ContentPack = z.infer<typeof contentPackResponse>;

const CONTENT_SCHEMA = {
  type: "object",
  properties: {
    title: str,
    concept: str,
    strategy: str,
    copy: str,
    caption: str,
    cta: str,
    script: str,
    visualDirection: str,
    imagePrompt: str,
    hashtags: strArr,
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: { title: str, text: str },
        required: ["title", "text"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "title",
    "concept",
    "strategy",
    "copy",
    "caption",
    "cta",
    "script",
    "visualDirection",
    "imagePrompt",
    "hashtags",
    "slides",
  ],
  additionalProperties: false,
};

export const contentPackInput = z.object({
  trendId: z.uuid(),
  clientId: z.uuid(),
  formats: z.array(z.enum(CONTENT_FORMAT_KEYS)).min(1, "Escolha ao menos um formato.").max(4),
  objective: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

export async function generateContentPack(actor: Actor, raw: z.input<typeof contentPackInput>) {
  const data = contentPackInput.parse(raw);
  const { prep, observed, brand, analysis } = await inOrg(actor, async (s) => {
    assertInternal(s.actor);
    assertCan(s.actor, "trends.read");
    assertCan(s.actor, "content.write");
    await assertClientAccess(s, data.clientId);
    const prep = await prepare(s, "copy", data.selection);
    const [observed] = await loadObserved(s, [data.trendId]);
    if (!observed) throw new NotFoundError("Tendência não encontrada.");
    const [analysis] = await s.db
      .select()
      .from(trendAnalyses)
      .where(
        and(
          eq(trendAnalyses.trendId, data.trendId),
          or(eq(trendAnalyses.clientId, data.clientId), sql`${trendAnalyses.clientId} is null`),
        ),
      )
      .orderBy(sql`${trendAnalyses.clientId} is null`, desc(trendAnalyses.createdAt))
      .limit(1);
    if (analysis?.kind === "client_fit" && analysis.recommended === false) {
      throw new ValidationError("A análise para esta marca não recomenda este tema. Revise antes de criar conteúdo.");
    }
    const brand = prep.allowClientContext ? await brandContext(s, data.clientId) : null;
    return { prep, observed, brand, analysis: analysis ?? null };
  });
  const formats = data.formats as ContentFormat[];
  const prompt = [
    "Formato da resposta: trend_content",
    `Crie um pacote de conteúdo para os formatos: ${formats.map((f) => CONTENT_FORMATS[f].label).join(", ")}.`,
    "Entregue: título interno, conceito, estratégia (por que este tema, para quem e com qual objetivo), copy principal (texto curto para a arte), legenda pronta para publicar, CTA, roteiro (só se houver Reels/vídeo; senão deixe vazio), direção visual (composição, cores, tipografia, estilo), um prompt para gerar a imagem principal SEM texto escrito na imagem e SEM pessoas reais identificáveis ou marcas de terceiros, até 8 hashtags e, se houver carrossel, de 3 a 7 páginas com título e texto.",
    "Não afirme números, recordes ou dados que não estejam nos dados observados. Não use a palavra viral.",
    data.objective ? `Objetivo da campanha: ${data.objective}` : null,
    data.notes ? `Observações da equipe: ${data.notes}` : null,
    analysis?.angles.length ? `Ângulos já sugeridos: ${analysis.angles.join(" | ")}` : null,
    analysis?.avoid.length ? `Evitar: ${analysis.avoid.join(" | ")}` : null,
    "",
    brand
      ? `Perfil da marca:\n${brand.text}`
      : "Perfil da marca: não enviado (a organização não autorizou dados de clientes). Use tom neutro e profissional.",
    "",
    "Tendência de origem (dados observados):",
    describeObserved(observed),
  ]
    .filter((l) => l !== null)
    .join("\n");
  const call = await callModel(actor, prep, {
    operation: "trend_content",
    confirmCost: data.confirmCost,
    system: SYSTEM,
    prompt,
    schema: CONTENT_SCHEMA,
    parse: contentPackResponse,
    clientId: data.clientId,
    maxTokens: 6000,
  });
  const notes: string[] = [];
  const allowed = allowedNumbers([observed]);
  const pack = cleanTexts(
    call.data,
    allowed,
    ["title", "concept", "strategy", "copy", "caption", "cta", "script", "visualDirection"],
    notes,
  );
  pack.slides = pack.slides.map((sl) => ({
    title: stripUnsupportedNumbers(sl.title, allowed).text,
    text: stripUnsupportedNumbers(sl.text, allowed).text,
  }));
  if (!formats.includes("carousel")) pack.slides = [];
  if (!formats.includes("reels") && !formats.includes("stories")) pack.script = pack.script ?? "";
  const generationId = await inOrg(actor, (s) =>
    recordSuccess(s, call, {
      title: `Conteúdo: ${observed.title}`.slice(0, 120),
      input: { trendId: data.trendId, clientId: data.clientId, formats },
      clientId: data.clientId,
    }),
  );
  return {
    pack,
    guardrails: notes,
    brandContextUsed: !!brand,
    analysisId: analysis?.id ?? null,
    generationId,
    demo: prep.demo,
    model: call.model,
  };
}
