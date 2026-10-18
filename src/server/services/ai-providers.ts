import { eq } from "drizzle-orm";
import type { AiModelInfo } from "@/lib/ai-tasks";
import { assertCan, type Scope } from "@/server/authz";
import { PROVIDER_IDS, providerDef, type ProviderDef } from "@/server/ai/registry";
import { AiProviderError, type AiProviderId } from "@/server/ai/types";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { aiProviderConfigs } from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

/** Modelos descobertos ficam em cache por 24 h; erros temporários são revalidados após 10 min. */
const MODELS_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_ERROR_MS = 10 * 60 * 1000;

type ConfigRow = typeof aiProviderConfigs.$inferSelect;

export type ProviderState = {
  id: AiProviderId;
  label: string;
  kinds: ProviderDef["kinds"];
  needsKey: boolean;
  /** De onde vem a chave: da organização (criptografada), do servidor ou de lugar nenhum. */
  keySource: "org" | "env" | "none";
  /** Somente para administradores: final da chave da organização, mascarado. */
  keyMask: string | null;
  enabled: boolean;
  status: ConfigRow["status"];
  lastError: string | null;
  lastCheckedAt: Date | null;
  models: AiModelInfo[];
  modelsFetchedAt: Date | null;
  /** Habilitado, com credencial válida e modelos disponíveis. */
  ready: boolean;
  params: string[];
  notes: string[];
};

function def(id: string): ProviderDef {
  const d = providerDef(id);
  if (!d) throw new NotFoundError("Provedor de IA desconhecido.");
  return d;
}

async function loadRows(s: Scope) {
  const rows = await s.db.select().from(aiProviderConfigs);
  return new Map(rows.map((r) => [r.provider, r]));
}

function keyOf(row: ConfigRow | undefined, d: ProviderDef): { key: string | null; source: ProviderState["keySource"] } {
  if (!d.needsKey) return { key: null, source: "none" };
  if (row?.keyEncrypted) {
    try {
      return { key: decryptSecret(row.keyEncrypted), source: "org" };
    } catch {
      return { key: null, source: "org" };
    }
  }
  const envKey = d.envKey();
  return envKey ? { key: envKey, source: "env" } : { key: null, source: "none" };
}

function stateOf(d: ProviderDef, row: ConfigRow | undefined, admin: boolean): ProviderState {
  const { key, source } = keyOf(row, d);
  // Com chave e sem registro, o provedor vale como habilitado (validado no primeiro uso).
  // O modo demonstração fica desligado até ser ativado de propósito (pela organização ou pelo servidor).
  const enabled = row ? row.enabled : d.needsKey ? source !== "none" : (d.defaultEnabled?.() ?? false);
  const status = row?.status ?? "unverified";
  return {
    id: d.id,
    label: d.label,
    kinds: d.kinds,
    needsKey: d.needsKey,
    keySource: source,
    keyMask: admin && source === "org" && key ? maskSecret(key) : null,
    enabled,
    status,
    lastError: row?.lastError ?? null,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    models: row?.models ?? [],
    modelsFetchedAt: row?.modelsFetchedAt ?? null,
    ready: enabled && status === "valid" && (row?.models.length ?? 0) > 0 && (source !== "none" || !d.needsKey),
    params: d.params,
    notes: d.notes,
  };
}

/** Estado das integrações. Sem `admin`, nenhum dado de chave é incluído. */
export async function providerStates(s: Scope, opts: { admin?: boolean } = {}): Promise<ProviderState[]> {
  if (opts.admin) assertCan(s.actor, "ai.settings");
  else assertCan(s.actor, "ai.use");
  const rows = await loadRows(s);
  return PROVIDER_IDS.map((id) => stateOf(def(id), rows.get(id), !!opts.admin));
}

async function upsert(s: Scope, provider: string, values: Partial<typeof aiProviderConfigs.$inferInsert>) {
  await s.db
    .insert(aiProviderConfigs)
    .values({ organizationId: s.actor.orgId, provider, ...values, updatedByUserId: s.actor.userId })
    .onConflictDoUpdate({
      target: [aiProviderConfigs.organizationId, aiProviderConfigs.provider],
      set: { ...values, updatedByUserId: s.actor.userId, updatedAt: new Date() },
    });
}

type Probe =
  | { ok: true; models: AiModelInfo[] }
  | { ok: false; status: "invalid" | "error"; error: string; models?: AiModelInfo[] };

/** Chamada real de listagem de modelos: valida a credencial sem gravar nada. */
async function probe(d: ProviderDef, key: string | null): Promise<Probe> {
  if (d.needsKey && !key) return { ok: false, status: "invalid", error: "Nenhuma chave configurada." };
  try {
    const models = await d.listModels(key ?? "", AbortSignal.timeout(20_000));
    if (!models.length) {
      return { ok: false, status: "error", error: "A conta não tem modelos compatíveis disponíveis.", models: [] };
    }
    return { ok: true, models };
  } catch (err) {
    if (!(err instanceof AiProviderError)) console.error(`[ai] falha ao validar ${d.id}`, err);
    const message = err instanceof AiProviderError ? err.message : "Não foi possível falar com o provedor.";
    const auth = err instanceof AiProviderError && err.kind === "auth";
    return { ok: false, status: auth ? "invalid" : "error", error: message };
  }
}

/** Valida e guarda o resultado (status, erro, modelos). Não altera a habilitação. */
async function check(s: Scope, d: ProviderDef, key: string | null): Promise<{ ok: boolean; error: string | null }> {
  const r = await probe(d, key);
  const now = new Date();
  if (r.ok) {
    await upsert(s, d.id, {
      status: "valid",
      lastError: null,
      lastCheckedAt: now,
      models: r.models,
      modelsFetchedAt: now,
    });
    return { ok: true, error: null };
  }
  await upsert(s, d.id, {
    status: r.status,
    lastError: r.error,
    lastCheckedAt: now,
    ...(r.models ? { models: r.models, modelsFetchedAt: now } : {}),
  });
  return { ok: false, error: r.error };
}

/**
 * Valida a nova chave com uma chamada real ao provedor e só então a guarda
 * (criptografada) e habilita o provedor. Chave recusada não substitui a atual.
 */
export async function saveProviderKey(s: Scope, provider: string, apiKey: string) {
  assertCan(s.actor, "ai.settings");
  const d = def(provider);
  if (!d.needsKey) throw new ValidationError("Este provedor não usa chave.");
  const key = apiKey.trim();
  if (key.length < 8 || key.length > 400) throw new ValidationError("Chave inválida.", { apiKey: ["Chave inválida"] });
  const r = await probe(d, key);
  if (r.ok) {
    const now = new Date();
    await upsert(s, d.id, {
      keyEncrypted: encryptSecret(key),
      enabled: true,
      status: "valid",
      lastError: null,
      lastCheckedAt: now,
      models: r.models,
      modelsFetchedAt: now,
    });
  }
  await recordActivity(s, {
    action: r.ok ? "ai_provider_key_saved" : "ai_provider_key_rejected",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: r.ok ? `Chave de ${d.label} validada e ativada` : `Chave de ${d.label} recusada na validação`,
    metadata: { provider: d.id, valid: r.ok },
    event: false,
  });
  return r.ok
    ? { ok: true as const, error: null, models: r.models.length }
    : { ok: false as const, error: r.error, models: 0 };
}

export async function removeProviderKey(s: Scope, provider: string) {
  assertCan(s.actor, "ai.settings");
  const d = def(provider);
  await upsert(s, d.id, {
    keyEncrypted: null,
    status: "unverified",
    lastError: null,
    models: [],
    modelsFetchedAt: null,
  });
  await recordActivity(s, {
    action: "ai_provider_key_removed",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: `Chave própria de ${d.label} removida`,
    metadata: { provider: d.id },
    event: false,
  });
}

/** Revalida a credencial e atualiza a lista de modelos. */
export async function validateProvider(s: Scope, provider: string) {
  assertCan(s.actor, "ai.settings");
  const d = def(provider);
  const rows = await loadRows(s);
  return check(s, d, keyOf(rows.get(d.id), d).key);
}

/** Habilita (somente depois de uma validação bem-sucedida) ou desabilita um provedor. */
export async function setProviderEnabled(s: Scope, provider: string, enabled: boolean) {
  assertCan(s.actor, "ai.settings");
  const d = def(provider);
  if (enabled) {
    const rows = await loadRows(s);
    const result = await check(s, d, keyOf(rows.get(d.id), d).key);
    if (!result.ok) throw new ValidationError(`Não foi possível habilitar ${d.label}: ${result.error}`);
  }
  await upsert(s, d.id, { enabled });
  await recordActivity(s, {
    action: enabled ? "ai_provider_enabled" : "ai_provider_disabled",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: `${d.label} ${enabled ? "habilitado" : "desabilitado"}`,
    metadata: { provider: d.id },
    event: false,
  });
}

/** Mesma lista de modelos (pelos ids); uma lista nova vazia não conta como mudança. */
function sameIds(live: AiModelInfo[], saved: AiModelInfo[]) {
  if (!live.length) return null;
  return live.map((m) => m.id).join("\n") === saved.map((m) => m.id).join("\n");
}

/**
 * Provedores prontos para uso agora, com suas chaves (somente no servidor).
 * Provedores com chave ainda não validada (ou com modelos desatualizados) são
 * validados aqui, antes do primeiro uso; credenciais inválidas não são
 * tentadas de novo até um administrador revalidar.
 */
export async function readyProviders(s: Scope) {
  const rows = await loadRows(s);
  const out: { def: ProviderDef; key: string | null; models: AiModelInfo[] }[] = [];
  const unavailable: { id: AiProviderId; label: string; reason: string }[] = [];
  for (const id of PROVIDER_IDS) {
    const d = def(id);
    let row = rows.get(id);
    const state = stateOf(d, row, false);
    if (!state.enabled) {
      unavailable.push({
        id,
        label: d.label,
        reason: state.keySource === "none" && d.needsKey ? "não configurado" : "desabilitado",
      });
      continue;
    }
    const { key } = keyOf(row, d);
    if (d.needsKey && !key) {
      unavailable.push({ id, label: d.label, reason: "sem chave válida" });
      continue;
    }
    const stale =
      !row ||
      row.status === "unverified" ||
      (row.status === "valid" &&
        (!row.modelsFetchedAt || Date.now() - row.modelsFetchedAt.getTime() > MODELS_TTL_MS)) ||
      (row.status === "error" && (!row.lastCheckedAt || Date.now() - row.lastCheckedAt.getTime() > RETRY_ERROR_MS));
    // Provedores locais (sem chave, ex.: demonstração) listam os modelos sem rede: a lista salva
    // acompanha a versão instalada (um modelo novo aparece sem precisar revalidar).
    const outdatedLocal =
      !d.needsKey &&
      sameIds(await d.listModels("", AbortSignal.timeout(5_000)).catch(() => []), row?.models ?? []) === false;
    if ((stale && d.needsKey) || (!d.needsKey && (!row?.models.length || outdatedLocal))) {
      await check(s, d, key);
      row = (await s.db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.provider, id)))[0];
    }
    if (!row || row.status !== "valid" || !row.models.length) {
      unavailable.push({ id, label: d.label, reason: row?.lastError ?? "credencial não validada" });
      continue;
    }
    out.push({ def: d, key, models: row.models });
  }
  return { ready: out, unavailable };
}
