import "server-only";
import { lookup } from "node:dns/promises";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { checkEndpointUrl, isPrivateIp } from "@/lib/endpoint-url";
import type { AiModelInfo } from "@/lib/ai-tasks";
import { PROVIDER_LABEL } from "@/lib/ai-select";
import { assertCan, assertInternal, type Scope } from "@/server/authz";
import { PROVIDER_IDS, providerDef, type ProviderDef } from "@/server/ai/registry";
import type { AiProviderId } from "@/server/ai/types";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { aiProviderConfigs, aiUsage, aiUserConnections } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { probeProvider } from "./ai-providers";
import { getSettings } from "./organizations";

/*
 * Conexões de IA pessoais (BYOK — "use sua própria chave"). Cada pessoa
 * cadastra a própria chave por provedor, dentro da organização atual:
 * - a chave é validada numa chamada real antes de ser guardada (criptografada);
 * - nunca volta ao navegador (só o final mascarado) nem entra em logs/auditoria;
 * - vale só para quem cadastrou: outra pessoa nunca a enxerga nem a usa;
 * - a organização pode proibir chaves pessoais (no geral ou por provedor);
 * - precedência no uso: chave pessoal válida e ativa > chave da organização >
 *   chave do servidor (src/server/services/ai-providers.ts, readyProviders).
 */

export const CONNECTABLE_PROVIDERS = PROVIDER_IDS.filter((id) => providerDef(id)?.needsKey) as AiProviderId[];

/* ------------------------------------------------------------------ */
/* Limite de tentativas de validação (por pessoa, por processo)        */
/* ------------------------------------------------------------------ */

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const attempts = new Map<string, number[]>();

function assertRate(userId: string) {
  const now = Date.now();
  const list = (attempts.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) {
    throw new ValidationError("Muitas tentativas de validação em pouco tempo. Aguarde alguns minutos.");
  }
  list.push(now);
  attempts.set(userId, list);
}

/** Só para testes: zera o contador de tentativas. */
export function resetConnectionRateLimit() {
  attempts.clear();
}

/* ------------------------------------------------------------------ */
/* Endereço personalizado (SSRF)                                       */
/* ------------------------------------------------------------------ */

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/**
 * Valida o endereço base informado: só https, nunca endereços internos —
 * nem por nome, nem por IP literal, nem por um nome que resolva para IP
 * privado. Devolve a URL normalizada.
 */
export async function validateEndpointUrl(raw: string, resolve: Resolver = defaultResolver): Promise<string> {
  const check = checkEndpointUrl(raw);
  if (!check.ok) throw new ValidationError(check.error, { endpointUrl: [check.error] });
  const literal = /^[\d.]+$/.test(check.host) || check.host.includes(":");
  if (!literal) {
    let addresses: string[];
    try {
      addresses = await resolve(check.host);
    } catch {
      throw new ValidationError("Não foi possível resolver o endereço informado.", { endpointUrl: ["Não resolvido"] });
    }
    if (!addresses.length || addresses.some((a) => isPrivateIp(a))) {
      throw new ValidationError("Endereços internos não são permitidos.", { endpointUrl: ["Endereço interno"] });
    }
  }
  return check.url;
}

/* ------------------------------------------------------------------ */
/* Política da organização                                             */
/* ------------------------------------------------------------------ */

export type ConnectionPolicy = { allowPersonalKeys: boolean; blocked: Set<string> };

export async function connectionPolicy(s: Scope): Promise<ConnectionPolicy> {
  const settings = await getSettings(s);
  const rows = await s.db
    .select({ provider: aiProviderConfigs.provider, allowUserKeys: aiProviderConfigs.allowUserKeys })
    .from(aiProviderConfigs);
  return {
    allowPersonalKeys: settings.ai.allowPersonalKeys,
    blocked: new Set(rows.filter((r) => !r.allowUserKeys).map((r) => r.provider)),
  };
}

export function policyReason(policy: ConnectionPolicy, provider: string): string | null {
  if (!policy.allowPersonalKeys) return "A organização não permite chaves de IA pessoais.";
  if (policy.blocked.has(provider)) return "A organização não permite chaves pessoais para este provedor.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Minhas conexões                                                     */
/* ------------------------------------------------------------------ */

export type ConnectionState = "not_configured" | "configured" | "working" | "error";

export type MyConnection = {
  provider: AiProviderId;
  label: string;
  kinds: ProviderDef["kinds"];
  /** Aceita endereço base personalizado (ex.: gateway compatível). */
  customEndpoint: boolean;
  keyHelp: string | null;
  notes: string[];
  state: ConnectionState;
  enabled: boolean;
  /** Final da chave, mascarado; nunca a chave inteira. */
  keyMask: string | null;
  endpointUrl: string | null;
  lastError: string | null;
  lastCheckedAt: Date | null;
  models: AiModelInfo[];
  /** Política da organização permite usar chave pessoal deste provedor. */
  allowed: boolean;
  policyReason: string | null;
};

function def(id: string): ProviderDef {
  const d = providerDef(id);
  if (!d || !d.needsKey) throw new NotFoundError("Provedor de IA desconhecido.");
  return d;
}

async function myRow(s: Scope, provider: string) {
  const [row] = await s.db
    .select()
    .from(aiUserConnections)
    .where(and(eq(aiUserConnections.userId, s.actor.userId), eq(aiUserConnections.provider, provider)));
  return row ?? null;
}

function stateOf(row: typeof aiUserConnections.$inferSelect | null): ConnectionState {
  if (!row) return "not_configured";
  if (row.status === "valid") return "working";
  if (row.status === "unverified") return "configured";
  return "error";
}

export async function listMyConnections(s: Scope): Promise<MyConnection[]> {
  assertInternal(s.actor);
  assertCan(s.actor, "ai.use");
  const policy = await connectionPolicy(s);
  const rows = await s.db.select().from(aiUserConnections).where(eq(aiUserConnections.userId, s.actor.userId));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return CONNECTABLE_PROVIDERS.map((id) => {
    const d = def(id);
    const row = byProvider.get(id) ?? null;
    const key = row ? decryptSecret(row.keyEncrypted) : null;
    return {
      provider: id,
      label: PROVIDER_LABEL[id] ?? d.label,
      kinds: d.kinds,
      customEndpoint: !!d.customEndpoint,
      keyHelp: d.keyHelp ?? null,
      notes: d.notes,
      state: stateOf(row),
      enabled: row?.enabled ?? false,
      keyMask: key ? maskSecret(key) : row ? "••••" : null,
      endpointUrl: row?.endpointUrl ?? null,
      lastError: row?.lastError ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      models: row?.models ?? [],
      allowed: policyReason(policy, id) === null,
      policyReason: policyReason(policy, id),
    };
  });
}

export const saveConnectionInput = z.object({
  provider: z.enum(CONNECTABLE_PROVIDERS as [string, ...string[]]),
  /** Ausente = manter a chave atual (ex.: só mudou o endereço). */
  apiKey: z.string().trim().min(8, "Chave inválida.").max(400).optional(),
  /** null/"" = remover o endereço personalizado; ausente = manter. */
  endpointUrl: z.string().trim().max(300).nullable().optional(),
});

export type SaveConnectionResult = { ok: true; error: null; models: number } | { ok: false; error: string; models: 0 };

/**
 * Valida a chave (e o endereço) numa chamada real e só então guarda,
 * criptografada, habilitando a conexão. Chave recusada não substitui a atual.
 */
export async function saveMyConnection(
  s: Scope,
  raw: z.input<typeof saveConnectionInput>,
  opts: { resolve?: Resolver } = {},
): Promise<SaveConnectionResult> {
  assertInternal(s.actor);
  assertCan(s.actor, "ai.use");
  const data = saveConnectionInput.parse(raw);
  const d = def(data.provider);
  const policy = await connectionPolicy(s);
  const reason = policyReason(policy, d.id);
  if (reason) throw new ForbiddenError(reason);
  const existing = await myRow(s, d.id);
  if (!data.apiKey && !existing) throw new ValidationError("Informe a chave de API.", { apiKey: ["Obrigatória"] });

  let endpointUrl: string | null = existing?.endpointUrl ?? null;
  if (data.endpointUrl !== undefined) {
    if (!data.endpointUrl) endpointUrl = null;
    else {
      if (!d.customEndpoint) {
        throw new ValidationError(`${d.label} não aceita endereço personalizado.`, {
          endpointUrl: ["Não suportado"],
        });
      }
      endpointUrl = await validateEndpointUrl(data.endpointUrl, opts.resolve);
    }
  }
  const key = data.apiKey ?? (existing ? decryptSecret(existing.keyEncrypted) : null);
  if (!key) throw new ValidationError("Não foi possível ler a chave guardada. Informe a chave de novo.");

  assertRate(s.actor.userId);
  const r = await probeProvider(d, key, { baseUrl: endpointUrl });
  const now = new Date();
  if (!r.ok) {
    await recordActivity(s, {
      action: "ai_connection_rejected",
      entityType: "user",
      entityId: s.actor.userId,
      summary: `Chave pessoal de ${d.label} recusada na validação`,
      metadata: { provider: d.id },
      event: false,
    });
    return { ok: false, error: r.error, models: 0 };
  }
  const values = {
    keyEncrypted: encryptSecret(key),
    endpointUrl,
    enabled: true,
    status: "valid" as const,
    lastError: null,
    lastCheckedAt: now,
    models: r.models,
    modelsFetchedAt: now,
  };
  await s.db
    .insert(aiUserConnections)
    .values({ organizationId: s.actor.orgId, userId: s.actor.userId, provider: d.id, ...values })
    .onConflictDoUpdate({
      target: [aiUserConnections.organizationId, aiUserConnections.userId, aiUserConnections.provider],
      set: { ...values, updatedAt: now },
    });
  await recordActivity(s, {
    action: "ai_connection_saved",
    entityType: "user",
    entityId: s.actor.userId,
    summary: `Chave pessoal de ${d.label} validada e ativada`,
    metadata: { provider: d.id, customEndpoint: !!endpointUrl },
    event: false,
  });
  return { ok: true, error: null, models: r.models.length };
}

/** Revalida a chave guardada (chamada real) e atualiza estado, erro e modelos. */
export async function testMyConnection(s: Scope, provider: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "ai.use");
  const d = def(provider);
  const row = await myRow(s, d.id);
  if (!row) throw new NotFoundError("Você ainda não conectou este provedor.");
  const key = decryptSecret(row.keyEncrypted);
  assertRate(s.actor.userId);
  const r = key
    ? await probeProvider(d, key, { baseUrl: row.endpointUrl })
    : {
        ok: false as const,
        status: "error" as const,
        error: "Não foi possível ler a chave guardada. Informe a chave de novo.",
      };
  const now = new Date();
  await s.db
    .update(aiUserConnections)
    .set(
      r.ok
        ? {
            status: "valid",
            lastError: null,
            lastCheckedAt: now,
            models: r.models,
            modelsFetchedAt: now,
            updatedAt: now,
          }
        : { status: r.status, lastError: r.error, lastCheckedAt: now, updatedAt: now },
    )
    .where(eq(aiUserConnections.id, row.id));
  return r.ok ? { ok: true as const, error: null, models: r.models.length } : { ok: false as const, error: r.error };
}

export async function setMyConnectionEnabled(s: Scope, provider: string, enabled: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "ai.use");
  const d = def(provider);
  const row = await myRow(s, d.id);
  if (!row) throw new NotFoundError("Você ainda não conectou este provedor.");
  if (enabled) {
    const reason = policyReason(await connectionPolicy(s), d.id);
    if (reason) throw new ForbiddenError(reason);
  }
  await s.db.update(aiUserConnections).set({ enabled, updatedAt: new Date() }).where(eq(aiUserConnections.id, row.id));
}

export async function removeMyConnection(s: Scope, provider: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "ai.use");
  const d = def(provider);
  await s.db
    .delete(aiUserConnections)
    .where(and(eq(aiUserConnections.userId, s.actor.userId), eq(aiUserConnections.provider, d.id)));
  await recordActivity(s, {
    action: "ai_connection_removed",
    entityType: "user",
    entityId: s.actor.userId,
    summary: `Chave pessoal de ${d.label} removida`,
    metadata: { provider: d.id },
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Consumo pessoal: chave própria × credenciais da plataforma          */
/* ------------------------------------------------------------------ */

export type UsageSlice = { requests: number; tokens: number; costMicros: number; unknownCost: number };

/** Meu consumo no mês: separado por origem da credencial (pessoal, organização/plataforma, não informada). */
export async function myAiUsage(s: Scope): Promise<{ personal: UsageSlice; shared: UsageSlice; unknown: UsageSlice }> {
  assertInternal(s.actor);
  assertCan(s.actor, "ai.use");
  const rows = await s.db
    .select({
      keySource: aiUsage.keySource,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint`,
      cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
      unknownCost: sql<number>`count(*) filter (where ${aiUsage.costMicros} is null)::int`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, s.actor.userId),
        sql`${aiUsage.status} <> 'blocked'`,
        gte(
          aiUsage.createdAt,
          sql`(date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`,
        ),
      ),
    )
    .groupBy(aiUsage.keySource);
  const empty = (): UsageSlice => ({ requests: 0, tokens: 0, costMicros: 0, unknownCost: 0 });
  const out = { personal: empty(), shared: empty(), unknown: empty() };
  for (const r of rows) {
    const slot =
      r.keySource === "user" ? out.personal : r.keySource === "org" || r.keySource === "env" ? out.shared : out.unknown;
    slot.requests += Number(r.requests);
    slot.tokens += Number(r.tokens);
    slot.costMicros += Number(r.cost);
    slot.unknownCost += Number(r.unknownCost);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Administração (sem segredos)                                        */
/* ------------------------------------------------------------------ */

/** Quantas pessoas conectaram chave própria por provedor (nenhum segredo). */
export async function personalConnectionStats(s: Scope) {
  assertCan(s.actor, "ai.settings");
  const rows = await s.db
    .select({
      provider: aiUserConnections.provider,
      total: sql<number>`count(*)::int`,
      working: sql<number>`count(*) filter (where ${aiUserConnections.status} = 'valid' and ${aiUserConnections.enabled})::int`,
    })
    .from(aiUserConnections)
    .groupBy(aiUserConnections.provider);
  return Object.fromEntries(
    rows.map((r) => [r.provider, { total: Number(r.total), working: Number(r.working) }]),
  ) as Record<string, { total: number; working: number }>;
}
