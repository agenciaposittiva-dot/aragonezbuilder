import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getOperation } from "@/lib/ai-operations";
import { AI_MODULES, AI_TASKS, operationTask, type AiModelInfo, type AiTask } from "@/lib/ai-tasks";
import { orgSettingsSchema } from "@/lib/org-settings";
import { buildPrompt, TASK_SUGGESTIONS_SCHEMA } from "@/server/ai/prompts";
import type { AiProvider } from "@/server/ai/types";
import { assertCan, assertClientAccess, assertProjectAccess, can, clientScope, type Scope } from "@/server/authz";
import { encryptSecret } from "@/server/crypto";
import {
  aiGenerations,
  aiModelPreferences,
  aiProviderConfigs,
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
import { AppError, ForbiddenError, LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { aiSelectionInput, listPreferences, resolveSelection } from "./ai-models";
import { providerStates } from "./ai-providers";
import { getSettings } from "./organizations";
import { createTask } from "./tasks";

/* ------------------------------------------------------------------ */
/* Provedor (resumo para a interface, sem chamadas de rede)            */
/* ------------------------------------------------------------------ */

export type ProviderSummary = {
  /** Algum provedor de IA real (ou a demonstração ativada) está disponível. */
  configured: boolean;
  demo: boolean;
  /** Provedor do padrão da organização (null = escolha automática). */
  provider: string | null;
  providerLabel: string;
  model: string | null;
  keySource: "org" | "env" | "none" | null;
};

/**
 * Resumo do padrão da organização e das integrações, sem validar credenciais
 * (a validação acontece antes do primeiro uso). Sem nenhum provedor, a IA fica
 * "não configurada" — não há respostas simuladas.
 */
export async function resolveProvider(s: Scope): Promise<ProviderSummary> {
  const [states, prefs] = [await providerStates(s), await listPreferences(s)];
  const org = prefs.find((p) => p.scope === "org" && !p.module && !p.task) ?? null;
  const usable = states.filter((p) => p.enabled && (p.keySource !== "none" || !p.needsKey));
  const chosen = org?.provider ? states.find((p) => p.id === org.provider) : null;
  return {
    configured: usable.length > 0,
    demo: usable.length > 0 && usable.every((p) => p.id === "demo"),
    provider: chosen?.id ?? null,
    providerLabel: chosen ? chosen.label : "Escolha automática",
    model: org?.model ?? null,
    keySource: chosen ? chosen.keySource : null,
  };
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
        // Tokens consumidos por respostas rejeitadas também contam.
        .where(and(gte(aiUsage.createdAt, startOfMonthSaoPaulo()), ne(aiUsage.status, "blocked"))),
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
  if (settings.monthlyCostLimitMicros > 0 && counters.monthCostMicros >= settings.monthlyCostLimitMicros) {
    throw new LimitError("O limite mensal de custo de IA da organização foi atingido. Fale com um administrador.");
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
  /** Módulo de origem (Assistente IA, editor…). */
  module: z.enum(Object.keys(AI_MODULES) as [string, ...string[]]).default("assistant"),
  /** Escolha de provedor/modelo para esta operação (padrão = preferências salvas). */
  selection: aiSelectionInput.optional(),
  /** Confirmação explícita para gerações acima do limite de custo configurado. */
  confirmCost: z.boolean().optional(),
});

/** Custo estimado acima do aviso configurado: a interface pede confirmação. */
export class CostConfirmationError extends AppError {
  /** `estimateMicros` nulo: o provedor não informa preço (ex.: geração de imagem). */
  constructor(readonly estimateMicros: number | null) {
    super(
      estimateMicros === null
        ? "O custo desta operação não é informado pelo provedor e pode ser alto. Confirme para continuar."
        : `Esta geração pode custar até US$ ${(estimateMicros / 1_000_000).toFixed(2)}. Confirme para continuar.`,
      "conflict",
    );
    this.name = "CostConfirmationError";
  }
}

/** Estimativa máxima (entrada aproximada + limite de saída) quando há preço de tabela. */
export function estimateMaxCostMicros(model: AiModelInfo, promptChars: number, maxTokens: number): number | null {
  if (!model.price) return null;
  return Math.round((promptChars / 4) * model.price.input + maxTokens * model.price.output);
}

export type PreparedGeneration = {
  operation: string;
  label: string;
  structured: boolean;
  system: string;
  prompt: string;
  maxTokens: number;
  model: AiModelInfo;
  provider: AiProvider;
  providerId: string;
  providerLabel: string;
  demo: boolean;
  module: string;
  task: AiTask;
  source: string;
  reason: string;
  warnings: string[];
  clientId: string | null;
  projectId: string | null;
  contextUsed: boolean;
  estimateMicros: number | null;
};

/**
 * Valida o pedido, verifica limites, resolve provedor/modelo (escolha
 * explícita, preferências ou automático) e monta o prompt. Dados do cliente
 * só entram no prompt se a organização autorizou (allowClientContext) ou se o
 * provedor é a demonstração local (que não envia nada para fora).
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
  const task = operationTask(op.key);
  if (AI_TASKS[task].kind !== "text") throw new ValidationError("Esta operação não gera texto.");
  const resolved = await resolveSelection(s, { module: data.module, task, selection: data.selection });
  const demo = resolved.def.id === "demo";
  const mayUseClientData = demo || settings.allowClientContext;

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
  const maxTokens = Math.min(op.structured ? 4000 : 8000, resolved.model.maxOutputTokens ?? Infinity);
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
    operation: op.key,
    label: op.label,
    structured: !!op.structured,
    system,
    prompt,
    maxTokens,
    model: resolved.model,
    provider: resolved.def.text!(resolved.apiKey ?? ""),
    providerId: resolved.def.id,
    providerLabel: resolved.def.label,
    demo,
    module: data.module,
    task,
    source: resolved.source,
    reason: resolved.reason,
    warnings: resolved.warnings,
    clientId,
    projectId: data.projectId ?? null,
    contextUsed: !!ctx,
    estimateMicros,
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
    projectId?: string | null;
    module?: string | null;
    task?: string | null;
    selectionSource?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    /** Null quando o provedor não dá dados suficientes (nada é inventado). */
    costMicros?: number | null;
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
      projectId: entry.projectId ?? null,
      provider: entry.provider,
      model: entry.model,
      operation: entry.operation,
      module: entry.module ?? null,
      task: entry.task ?? null,
      selectionSource: entry.selectionSource ?? null,
      inputTokens: entry.inputTokens ?? 0,
      outputTokens: entry.outputTokens ?? 0,
      costMicros: entry.costMicros ?? null,
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

const usd = z.coerce.number().min(0).max(1_000_000);

/**
 * Política de uso da organização. `provider`/`model`/`apiKey` são aceitos por
 * compatibilidade: definem o padrão geral da organização e a chave própria
 * (sempre criptografada, validada antes do primeiro uso).
 */
export const aiSettingsInput = z.object({
  enabled: z.boolean(),
  allowClientContext: z.boolean(),
  allowChatContext: z.boolean().optional(),
  monthlyTokenLimit: z.coerce.number().int().min(0).max(1_000_000_000),
  userDailyRequestLimit: z.coerce.number().int().min(0).max(100_000),
  /** Limites de custo em US$ (convertidos para micro-dólares). */
  monthlyCostLimitUsd: usd.optional(),
  confirmAboveUsd: usd.optional(),
  provider: z.enum(["anthropic", "openai", "gemini", "demo"]).optional(),
  model: z.string().trim().max(160).optional(),
  /** undefined = manter; "" = remover; texto = nova chave. */
  apiKey: z.string().trim().max(400).optional(),
});

export async function getAiSettingsView(s: Scope) {
  assertCan(s.actor, "ai.settings");
  const settings = (await getSettings(s)).ai;
  return {
    enabled: settings.enabled,
    allowClientContext: settings.allowClientContext,
    allowChatContext: settings.allowChatContext,
    monthlyTokenLimit: settings.monthlyTokenLimit,
    userDailyRequestLimit: settings.userDailyRequestLimit,
    monthlyCostLimitUsd: settings.monthlyCostLimitMicros / 1_000_000,
    confirmAboveUsd: settings.confirmAboveMicros / 1_000_000,
  };
}

export async function updateAiSettings(s: Scope, raw: z.input<typeof aiSettingsInput>) {
  assertCan(s.actor, "ai.settings");
  const data = aiSettingsInput.parse(raw);
  const current = await getSettings(s);
  const next = orgSettingsSchema.parse({
    ...current,
    ai: {
      ...current.ai,
      enabled: data.enabled,
      allowClientContext: data.allowClientContext,
      ...(data.allowChatContext !== undefined ? { allowChatContext: data.allowChatContext } : {}),
      monthlyTokenLimit: data.monthlyTokenLimit,
      userDailyRequestLimit: data.userDailyRequestLimit,
      ...(data.monthlyCostLimitUsd !== undefined
        ? { monthlyCostLimitMicros: Math.round(data.monthlyCostLimitUsd * 1_000_000) }
        : {}),
      ...(data.confirmAboveUsd !== undefined
        ? { confirmAboveMicros: Math.round(data.confirmAboveUsd * 1_000_000) }
        : {}),
      ...(data.provider ? { provider: data.provider, model: data.model ?? "" } : {}),
    },
  });
  await s.db.update(organizations).set({ settings: next }).where(eq(organizations.id, s.actor.orgId));

  if (data.provider) {
    // Padrão geral da organização (compatibilidade com a configuração antiga).
    await s.db
      .delete(aiModelPreferences)
      .where(
        and(isNull(aiModelPreferences.userId), eq(aiModelPreferences.module, ""), eq(aiModelPreferences.task, "")),
      );
    await s.db.insert(aiModelPreferences).values({
      organizationId: s.actor.orgId,
      provider: data.provider,
      model: data.model || null,
      priority: "balanced",
    });
    if (data.provider !== "demo" && data.apiKey !== undefined) {
      const values = data.apiKey
        ? { keyEncrypted: encryptSecret(data.apiKey), status: "unverified" as const, enabled: true }
        : { keyEncrypted: null, status: "unverified" as const, models: [], modelsFetchedAt: null };
      await s.db
        .insert(aiProviderConfigs)
        .values({ organizationId: s.actor.orgId, provider: data.provider, ...values, updatedByUserId: s.actor.userId })
        .onConflictDoUpdate({
          target: [aiProviderConfigs.organizationId, aiProviderConfigs.provider],
          set: { ...values, updatedByUserId: s.actor.userId, updatedAt: new Date() },
        });
    }
    if (data.provider === "demo") {
      await s.db
        .insert(aiProviderConfigs)
        .values({ organizationId: s.actor.orgId, provider: "demo", enabled: true, updatedByUserId: s.actor.userId })
        .onConflictDoUpdate({
          target: [aiProviderConfigs.organizationId, aiProviderConfigs.provider],
          set: { enabled: true, updatedAt: new Date() },
        });
    }
  }

  await recordActivity(s, {
    action: "ai_settings_updated",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: "Configurações de IA atualizadas",
    metadata: {
      allowClientContext: data.allowClientContext,
      allowChatContext: data.allowChatContext ?? null,
      provider: data.provider ?? null,
      keyChanged: data.apiKey !== undefined,
    },
    event: false,
  });
}

export async function aiUsageReport(s: Scope) {
  assertCan(s.actor, "ai.settings");
  const [byMonth, byUser, byOperation, byModel, recentErrors, recent] = await inSequence(
    () =>
      s.db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${aiUsage.createdAt} at time zone 'America/Sao_Paulo'), 'YYYY-MM')`,
          requests: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint`,
          cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
          unknownCost: sql<number>`count(*) filter (where ${aiUsage.costMicros} is null and ${aiUsage.status} <> 'blocked')::int`,
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
          unknownCost: sql<number>`count(*) filter (where ${aiUsage.costMicros} is null and ${aiUsage.status} <> 'blocked')::int`,
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
          provider: aiUsage.provider,
          model: aiUsage.model,
          requests: sql<number>`count(*)::int`,
          errors: sql<number>`count(*) filter (where ${aiUsage.status} = 'error')::int`,
          tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint`,
          cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
          unknownCost: sql<number>`count(*) filter (where ${aiUsage.costMicros} is null and ${aiUsage.status} <> 'blocked')::int`,
          avgLatencyMs: sql<number | null>`round(avg(${aiUsage.latencyMs}))::int`,
        })
        .from(aiUsage)
        .where(and(gte(aiUsage.createdAt, startOfMonthSaoPaulo()), ne(aiUsage.status, "blocked")))
        .groupBy(aiUsage.provider, aiUsage.model)
        .orderBy(sql`3 desc`)
        .limit(20),
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
    () =>
      s.db
        .select({
          id: aiUsage.id,
          createdAt: aiUsage.createdAt,
          provider: aiUsage.provider,
          model: aiUsage.model,
          operation: aiUsage.operation,
          module: aiUsage.module,
          task: aiUsage.task,
          selectionSource: aiUsage.selectionSource,
          status: aiUsage.status,
          inputTokens: aiUsage.inputTokens,
          outputTokens: aiUsage.outputTokens,
          costMicros: aiUsage.costMicros,
          latencyMs: aiUsage.latencyMs,
          errorMessage: aiUsage.errorMessage,
          userName: user.name,
          clientName: clients.name,
          projectName: projects.name,
        })
        .from(aiUsage)
        .leftJoin(user, eq(user.id, aiUsage.userId))
        .leftJoin(clients, eq(clients.id, aiUsage.clientId))
        .leftJoin(projects, eq(projects.id, aiUsage.projectId))
        .orderBy(desc(aiUsage.createdAt))
        .limit(30),
  );
  return {
    byMonth: byMonth.map((r) => ({ ...r, tokens: Number(r.tokens), cost: Number(r.cost) })),
    byUser: byUser.map((r) => ({ ...r, tokens: Number(r.tokens), cost: Number(r.cost) })),
    byOperation: byOperation.map((r) => ({ ...r, tokens: Number(r.tokens) })),
    byModel: byModel.map((r) => ({ ...r, tokens: Number(r.tokens), cost: Number(r.cost) })),
    recentErrors,
    recent,
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
