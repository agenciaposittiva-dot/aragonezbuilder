import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getOperation } from "@/lib/ai-operations";
import { orgSettingsSchema } from "@/lib/org-settings";
import { createAnthropicProvider, ANTHROPIC_MODELS } from "@/server/ai/providers/anthropic";
import { createDemoProvider } from "@/server/ai/providers/demo";
import { createGeminiProvider } from "@/server/ai/providers/gemini";
import { createOpenAiProvider } from "@/server/ai/providers/openai";
import { buildPrompt, TASK_SUGGESTIONS_SCHEMA } from "@/server/ai/prompts";
import type { AiProvider } from "@/server/ai/types";
import { assertCan, assertClientAccess, assertProjectAccess, can, clientScope, type Scope } from "@/server/authz";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import {
  aiGenerations,
  aiUsage,
  brandProfiles,
  clients,
  clientServices,
  organizations,
  projects,
  projectStages,
  user,
} from "@/server/db/schema";
import { inSequence } from "@/server/db/sequence";
import { env } from "@/server/env";
import { ForbiddenError, LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { getSettings } from "./organizations";
import { createTask } from "./tasks";

/* ------------------------------------------------------------------ */
/* Provedor                                                            */
/* ------------------------------------------------------------------ */

export type ResolvedProvider = { provider: AiProvider; model: string; demo: boolean; keySource: "org" | "env" | null };

/** Escolhe provedor, modelo e chave (da organização, criptografada, ou do ambiente). */
export async function resolveProvider(s: Scope): Promise<ResolvedProvider> {
  const settings = (await getSettings(s)).ai;
  if (settings.provider === "demo")
    return { provider: createDemoProvider(), model: "demo", demo: true, keySource: null };

  const orgKey = settings.keys[settings.provider] ? decryptSecret(settings.keys[settings.provider]!) : null;
  const envKey = { anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY, gemini: env.GEMINI_API_KEY }[
    settings.provider
  ];
  const key = orgKey ?? envKey ?? null;
  if (!key) return { provider: createDemoProvider(), model: "demo", demo: true, keySource: null };

  const provider =
    settings.provider === "anthropic"
      ? createAnthropicProvider(key)
      : settings.provider === "gemini"
        ? createGeminiProvider(key)
        : createOpenAiProvider(key);
  const model = settings.model || provider.defaultModel;
  return { provider, model, demo: false, keySource: orgKey ? "org" : "env" };
}

/* ------------------------------------------------------------------ */
/* Limites                                                             */
/* ------------------------------------------------------------------ */

function startOfTodaySaoPaulo() {
  return sql`(date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`;
}
function startOfMonthSaoPaulo() {
  return sql`(date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`;
}

export async function usageCounters(s: Scope) {
  const [[month], [today]] = await inSequence(
    () =>
      s.db
        .select({
          tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint`,
          cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
        })
        .from(aiUsage)
        .where(and(gte(aiUsage.createdAt, startOfMonthSaoPaulo()), eq(aiUsage.status, "success"))),
    () =>
      s.db
        .select({ n: count() })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userId, s.actor.userId),
            gte(aiUsage.createdAt, startOfTodaySaoPaulo()),
            ne(aiUsage.status, "blocked"),
          ),
        ),
  );
  return {
    monthTokens: Number(month?.tokens ?? 0),
    monthCostMicros: Number(month?.cost ?? 0),
    myRequestsToday: today?.n ?? 0,
  };
}

/** Garante que o ator pode gerar agora (módulo ativo, permissão e limites). */
export async function assertCanGenerate(s: Scope) {
  assertCan(s.actor, "ai.use");
  const settings = (await getSettings(s)).ai;
  if (!settings.enabled) throw new ForbiddenError("O assistente de IA está desativado nesta organização.");
  const counters = await usageCounters(s);
  if (settings.monthlyTokenLimit > 0 && counters.monthTokens >= settings.monthlyTokenLimit) {
    throw new LimitError("O limite mensal de uso de IA da organização foi atingido. Fale com um administrador.");
  }
  if (settings.userDailyRequestLimit > 0 && counters.myRequestsToday >= settings.userDailyRequestLimit) {
    throw new LimitError(`Você atingiu o limite de ${settings.userDailyRequestLimit} gerações por dia.`);
  }
  return settings;
}

/* ------------------------------------------------------------------ */
/* Contexto (somente com autorização da organização)                   */
/* ------------------------------------------------------------------ */

async function clientContext(s: Scope, clientId: string): Promise<string> {
  await assertClientAccess(s, clientId);
  const [row] = await s.db
    .select({ client: clients, brand: brandProfiles })
    .from(clients)
    .leftJoin(brandProfiles, eq(brandProfiles.clientId, clients.id))
    .where(eq(clients.id, clientId));
  if (!row) throw new NotFoundError("Cliente não encontrado.");
  const services = await s.db
    .select({ name: clientServices.name })
    .from(clientServices)
    .where(and(eq(clientServices.clientId, clientId), eq(clientServices.status, "active")))
    .orderBy(asc(clientServices.name));
  const b = row.brand;
  const parts = [
    `Contexto da marca "${row.client.name}"${row.client.industry ? ` (segmento: ${row.client.industry})` : ""}:`,
    b?.toneOfVoice ? `- Tom de voz: ${b.toneOfVoice}` : null,
    b?.audience ? `- Público-alvo: ${b.audience}` : null,
    b?.objectives ? `- Objetivos: ${b.objectives}` : null,
    b?.positioning ? `- Posicionamento: ${b.positioning}` : null,
    b?.keywords?.length ? `- Palavras-chave: ${b.keywords.join(", ")}` : null,
    b?.avoid ? `- Evitar: ${b.avoid}` : null,
    b?.colors?.length ? `- Cores: ${b.colors.map((c) => `${c.name || "cor"} ${c.hex}`).join(", ")}` : null,
    b?.fonts?.length ? `- Tipografia: ${b.fonts.map((f) => f.name).join(", ")}` : null,
    services.length ? `- Serviços contratados: ${services.map((x) => x.name).join(", ")}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

async function projectContext(s: Scope, projectId: string): Promise<{ text: string; clientId: string }> {
  const p = await assertProjectAccess(s, projectId);
  const [row] = await s.db.select().from(projects).where(eq(projects.id, projectId));
  const stages = await s.db
    .select({ name: projectStages.name })
    .from(projectStages)
    .where(eq(projectStages.projectId, projectId))
    .orderBy(asc(projectStages.position));
  const text = [
    `Projeto: ${row!.name}`,
    row!.objective ? `Objetivo do projeto: ${row!.objective}` : null,
    row!.description ? `Descrição: ${row!.description}` : null,
    row!.dueDate ? `Prazo: ${row!.dueDate}` : null,
    stages.length ? `Etapas: ${stages.map((x) => x.name).join(" → ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { text, clientId: p.clientId };
}

/* ------------------------------------------------------------------ */
/* Preparação e registro                                               */
/* ------------------------------------------------------------------ */

export const generateInput = z.object({
  operation: z.string().min(1).max(60),
  input: z.record(z.string(), z.string().max(20000)).default({}),
  clientId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
});

export type PreparedGeneration = {
  operation: string;
  label: string;
  structured: boolean;
  system: string;
  prompt: string;
  model: string;
  provider: AiProvider;
  demo: boolean;
  clientId: string | null;
  contextUsed: boolean;
};

/**
 * Valida o pedido, verifica limites e monta o prompt. Dados do cliente só
 * entram no prompt se a organização autorizou (allowClientContext) ou se o
 * provedor é o de demonstração (que não envia nada para fora).
 */
export async function prepareGeneration(s: Scope, raw: z.input<typeof generateInput>): Promise<PreparedGeneration> {
  const data = generateInput.parse(raw);
  const op = getOperation(data.operation);
  if (!op) throw new ValidationError("Operação desconhecida.");
  for (const f of op.fields) {
    if (f.required && !data.input[f.key]?.trim())
      throw new ValidationError(`Preencha: ${f.label}.`, { [f.key]: ["Obrigatório"] });
  }
  if (op.needsProject && !data.projectId)
    throw new ValidationError("Escolha o projeto.", { projectId: ["Obrigatório"] });

  const settings = await assertCanGenerate(s);
  const resolved = await resolveProvider(s);
  const mayUseClientData = resolved.demo || settings.allowClientContext;

  let clientId = data.clientId ?? null;
  let project: { text: string; clientId: string } | null = null;
  if (data.projectId) {
    project = await projectContext(s, data.projectId);
    clientId = project.clientId;
  }
  if (clientId) await assertClientAccess(s, clientId);

  const ctx = clientId && mayUseClientData ? await clientContext(s, clientId) : undefined;
  const projectText = project
    ? mayUseClientData
      ? project.text
      : "Projeto: (detalhes omitidos — a organização não autorizou o envio de dados de clientes)"
    : undefined;
  const { system, prompt } = buildPrompt(op, data.input, { clientContext: ctx, projectContext: projectText });

  return {
    operation: op.key,
    label: op.label,
    structured: !!op.structured,
    system,
    prompt,
    model: resolved.model,
    provider: resolved.provider,
    demo: resolved.demo,
    clientId,
    contextUsed: !!ctx,
  };
}

export function structuredSchema(prepared: PreparedGeneration) {
  return prepared.structured ? (TASK_SUGGESTIONS_SCHEMA as unknown as Record<string, unknown>) : undefined;
}

export async function recordUsage(
  s: Scope,
  entry: {
    provider: string;
    model: string;
    operation: string;
    clientId: string | null;
    inputTokens?: number;
    outputTokens?: number;
    costMicros?: number;
    status: "success" | "error" | "blocked";
    errorMessage?: string | null;
    latencyMs?: number | null;
  },
) {
  const [row] = await s.db
    .insert(aiUsage)
    .values({
      organizationId: s.actor.orgId,
      userId: s.actor.userId,
      clientId: entry.clientId,
      provider: entry.provider,
      model: entry.model,
      operation: entry.operation,
      inputTokens: entry.inputTokens ?? 0,
      outputTokens: entry.outputTokens ?? 0,
      costMicros: entry.costMicros ?? 0,
      status: entry.status,
      errorMessage: entry.errorMessage?.slice(0, 500) ?? null,
      latencyMs: entry.latencyMs ?? null,
    })
    .returning({ id: aiUsage.id });
  return row!.id;
}

export async function saveGeneration(
  s: Scope,
  g: {
    usageId: string;
    kind: string;
    title: string;
    input: Record<string, unknown>;
    output: string;
    provider: string;
    model: string;
    clientId: string | null;
  },
) {
  const [row] = await s.db
    .insert(aiGenerations)
    .values({
      organizationId: s.actor.orgId,
      userId: s.actor.userId,
      clientId: g.clientId,
      kind: g.kind,
      title: g.title.slice(0, 160),
      input: g.input,
      output: g.output,
      provider: g.provider,
      model: g.model,
      usageId: g.usageId,
    })
    .returning({ id: aiGenerations.id });
  return row!.id;
}

/* ------------------------------------------------------------------ */
/* Histórico                                                           */
/* ------------------------------------------------------------------ */

export async function listGenerations(s: Scope, opts: { clientId?: string; pinned?: boolean; limit?: number } = {}) {
  assertCan(s.actor, "ai.use");
  const visibleClients = s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
  return s.db
    .select({
      id: aiGenerations.id,
      kind: aiGenerations.kind,
      title: aiGenerations.title,
      output: aiGenerations.output,
      model: aiGenerations.model,
      pinnedAt: aiGenerations.pinnedAt,
      createdAt: aiGenerations.createdAt,
      clientId: aiGenerations.clientId,
      clientName: clients.name,
      userId: aiGenerations.userId,
      userName: user.name,
    })
    .from(aiGenerations)
    .leftJoin(clients, eq(clients.id, aiGenerations.clientId))
    .leftJoin(user, eq(user.id, aiGenerations.userId))
    .where(
      and(
        or(isNull(aiGenerations.clientId), inArray(aiGenerations.clientId, visibleClients)),
        opts.clientId ? eq(aiGenerations.clientId, opts.clientId) : undefined,
        opts.pinned ? sql`${aiGenerations.pinnedAt} is not null` : undefined,
      ),
    )
    .orderBy(sql`${aiGenerations.pinnedAt} desc nulls last`, desc(aiGenerations.createdAt))
    .limit(opts.limit ?? 30);
}

async function ownGeneration(s: Scope, id: string) {
  const [g] = await s.db.select().from(aiGenerations).where(eq(aiGenerations.id, id));
  if (!g) throw new NotFoundError("Geração não encontrada.");
  if (g.userId !== s.actor.userId && !can(s.actor, "ai.settings")) throw new ForbiddenError();
  return g;
}

export async function togglePinGeneration(s: Scope, id: string) {
  assertCan(s.actor, "ai.use");
  const g = await ownGeneration(s, id);
  await s.db
    .update(aiGenerations)
    .set({ pinnedAt: g.pinnedAt ? null : new Date() })
    .where(eq(aiGenerations.id, id));
}

export async function deleteGeneration(s: Scope, id: string) {
  assertCan(s.actor, "ai.use");
  await ownGeneration(s, id);
  await s.db.delete(aiGenerations).where(eq(aiGenerations.id, id));
}

/* ------------------------------------------------------------------ */
/* Configurações e relatório de uso                                    */
/* ------------------------------------------------------------------ */

export const aiSettingsInput = z.object({
  enabled: z.boolean(),
  provider: z.enum(["anthropic", "openai", "gemini", "demo"]),
  model: z.string().trim().max(80).default(""),
  allowClientContext: z.boolean(),
  monthlyTokenLimit: z.coerce.number().int().min(0).max(1_000_000_000),
  userDailyRequestLimit: z.coerce.number().int().min(0).max(100_000),
  /** undefined = manter; "" = remover; texto = nova chave. */
  apiKey: z.string().trim().max(400).optional(),
});

export async function getAiSettingsView(s: Scope) {
  assertCan(s.actor, "ai.settings");
  const settings = (await getSettings(s)).ai;
  const orgKey = settings.keys[settings.provider === "demo" ? "anthropic" : settings.provider];
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    allowClientContext: settings.allowClientContext,
    monthlyTokenLimit: settings.monthlyTokenLimit,
    userDailyRequestLimit: settings.userDailyRequestLimit,
    orgKeyMask: orgKey ? maskSecret(decryptSecret(orgKey)) : null,
    envKeys: { anthropic: !!env.ANTHROPIC_API_KEY, openai: !!env.OPENAI_API_KEY, gemini: !!env.GEMINI_API_KEY },
    anthropicModels: ANTHROPIC_MODELS,
  };
}

export async function updateAiSettings(s: Scope, raw: z.input<typeof aiSettingsInput>) {
  assertCan(s.actor, "ai.settings");
  const data = aiSettingsInput.parse(raw);
  const current = await getSettings(s);
  const keys = { ...current.ai.keys };
  if (data.provider !== "demo" && data.apiKey !== undefined) {
    if (data.apiKey === "") delete keys[data.provider];
    else keys[data.provider] = encryptSecret(data.apiKey);
  }
  const next = orgSettingsSchema.parse({
    ...current,
    ai: {
      enabled: data.enabled,
      provider: data.provider,
      model: data.model,
      allowClientContext: data.allowClientContext,
      monthlyTokenLimit: data.monthlyTokenLimit,
      userDailyRequestLimit: data.userDailyRequestLimit,
      keys,
    },
  });
  await s.db.update(organizations).set({ settings: next }).where(eq(organizations.id, s.actor.orgId));
  await recordActivity(s, {
    action: "ai_settings_updated",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: "Configurações de IA atualizadas",
    metadata: {
      provider: data.provider,
      model: data.model,
      allowClientContext: data.allowClientContext,
      keyChanged: data.apiKey !== undefined,
    },
    event: false,
  });
}

export async function aiUsageReport(s: Scope) {
  assertCan(s.actor, "ai.settings");
  const [byMonth, byUser, byOperation, recentErrors] = await inSequence(
    () =>
      s.db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${aiUsage.createdAt} at time zone 'America/Sao_Paulo'), 'YYYY-MM')`,
          requests: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint`,
          cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
          errors: sql<number>`count(*) filter (where ${aiUsage.status} = 'error')::int`,
          blocked: sql<number>`count(*) filter (where ${aiUsage.status} = 'blocked')::int`,
        })
        .from(aiUsage)
        .where(gte(aiUsage.createdAt, sql`now() - interval '6 months'`))
        .groupBy(sql`1`)
        .orderBy(sql`1 desc`),
    () =>
      s.db
        .select({
          userName: user.name,
          requests: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint`,
          cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
        })
        .from(aiUsage)
        .leftJoin(user, eq(user.id, aiUsage.userId))
        .where(gte(aiUsage.createdAt, startOfMonthSaoPaulo()))
        .groupBy(user.name)
        .orderBy(sql`3 desc`)
        .limit(20),
    () =>
      s.db
        .select({
          operation: aiUsage.operation,
          requests: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint`,
        })
        .from(aiUsage)
        .where(gte(aiUsage.createdAt, startOfMonthSaoPaulo()))
        .groupBy(aiUsage.operation)
        .orderBy(sql`2 desc`),
    () =>
      s.db
        .select({
          createdAt: aiUsage.createdAt,
          operation: aiUsage.operation,
          status: aiUsage.status,
          errorMessage: aiUsage.errorMessage,
        })
        .from(aiUsage)
        .where(ne(aiUsage.status, "success"))
        .orderBy(desc(aiUsage.createdAt))
        .limit(10),
  );
  return {
    byMonth: byMonth.map((r) => ({ ...r, tokens: Number(r.tokens), cost: Number(r.cost) })),
    byUser: byUser.map((r) => ({ ...r, tokens: Number(r.tokens), cost: Number(r.cost) })),
    byOperation: byOperation.map((r) => ({ ...r, tokens: Number(r.tokens) })),
    recentErrors,
  };
}

/* ------------------------------------------------------------------ */
/* Fluxo assistido: criar tarefas sugeridas (após revisão do usuário)  */
/* ------------------------------------------------------------------ */

export const suggestedTasksInput = z.object({
  projectId: z.uuid(),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(4000).default(""),
        estimateMinutes: z.coerce.number().int().min(0).max(100_000).default(0),
      }),
    )
    .min(1, "Selecione pelo menos uma tarefa")
    .max(30),
});

/**
 * Cria as tarefas que o usuário revisou e confirmou. A IA nunca cria
 * registros sozinha: esta função só roda a partir de um clique explícito.
 */
export async function createSuggestedTasks(s: Scope, raw: z.input<typeof suggestedTasksInput>) {
  assertCan(s.actor, "tasks.write");
  const data = suggestedTasksInput.parse(raw);
  let created = 0;
  for (const t of data.tasks) {
    await createTask(s, {
      projectId: data.projectId,
      title: t.title,
      description: t.description || null,
      estimateMinutes: t.estimateMinutes || null,
    });
    created++;
  }
  return { created };
}
