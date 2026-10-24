import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  autoSelect,
  compatibleModels,
  pickPreference,
  PREFERENCE_LEVEL_LABEL,
  PROVIDER_LABEL,
  type AiPreference,
  type AiSelection,
  type PreferenceLevel,
} from "@/lib/ai-select";
import {
  AI_MODULES,
  AI_PRIORITIES,
  AI_TASKS,
  CAP_LABEL,
  compatibility,
  incompatibilityMessage,
  type AiModelInfo,
  type AiPriority,
  type AiTask,
} from "@/lib/ai-tasks";
import { assertCan, type Scope } from "@/server/authz";
import { providerDef, type ProviderDef } from "@/server/ai/registry";
import { aiModelPreferences } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { personalReadyModels, providerStates, readyProviders } from "./ai-providers";

/* ------------------------------------------------------------------ */
/* Erros com alternativas                                              */
/* ------------------------------------------------------------------ */

export type ModelAlternative = { provider: string; providerLabel: string; model: string; label: string };

/**
 * Escolha inválida (modelo indisponível, incompatível ou nenhum provedor).
 * Nunca trocamos de modelo sozinhos: o erro traz alternativas compatíveis
 * para o usuário escolher.
 */
export class ModelSelectionError extends AppError {
  constructor(
    message: string,
    readonly reason: "no_provider" | "model_unavailable" | "model_incompatible" | "no_compatible",
    readonly alternatives: ModelAlternative[] = [],
  ) {
    super(message, "validation");
    this.name = "ModelSelectionError";
  }
}

function alternativesFor(models: AiModelInfo[], task: AiTask, priority: AiPriority, exclude?: string) {
  const list = compatibleModels(models, task).filter((m) => `${m.provider}:${m.id}` !== exclude);
  const best = autoSelect(list, task, priority)?.model;
  const ordered = best ? [best, ...list.filter((m) => m !== best)] : list;
  return ordered.slice(0, 6).map((m) => ({
    provider: m.provider,
    providerLabel: PROVIDER_LABEL[m.provider] ?? m.provider,
    model: m.id,
    label: m.label,
  }));
}

/* ------------------------------------------------------------------ */
/* Preferências                                                        */
/* ------------------------------------------------------------------ */

const priorityEnum = z.enum(Object.keys(AI_PRIORITIES) as [AiPriority, ...AiPriority[]]);

export const aiSelectionInput = z
  .object({
    mode: z.enum(["default", "auto", "manual"]).default("default"),
    provider: z.string().trim().max(40).nullish(),
    model: z.string().trim().max(160).nullish(),
    priority: priorityEnum.optional(),
  })
  .prefault({});

export const aiPreferenceInput = z.object({
  scope: z.enum(["org", "user"]),
  module: z.union([z.enum(Object.keys(AI_MODULES) as [string, ...string[]]), z.literal("")]).default(""),
  task: z.union([z.enum(Object.keys(AI_TASKS) as [string, ...string[]]), z.literal("")]).default(""),
  /** Nulo = escolher automaticamente. */
  provider: z.string().trim().max(40).nullish(),
  model: z.string().trim().max(160).nullish(),
  priority: priorityEnum.default("balanced"),
});

/** Preferências que valem para a pessoa: as dela e as da organização. */
export async function listPreferences(s: Scope): Promise<AiPreference[]> {
  assertCan(s.actor, "ai.use");
  const rows = await s.db
    .select()
    .from(aiModelPreferences)
    .where(or(isNull(aiModelPreferences.userId), eq(aiModelPreferences.userId, s.actor.userId)));
  return rows.map((r) => ({
    scope: r.userId ? "user" : "org",
    module: r.module,
    task: r.task,
    provider: r.provider,
    model: r.model,
    priority: (r.priority in AI_PRIORITIES ? r.priority : "balanced") as AiPriority,
  }));
}

/**
 * Salva um padrão (organização exige `ai.settings`; o da pessoa, `ai.use`).
 * O modelo precisa existir entre os modelos do provedor e ser compatível com
 * a tarefa, quando ela é informada.
 */
export async function setPreference(s: Scope, raw: z.input<typeof aiPreferenceInput>) {
  const data = aiPreferenceInput.parse(raw);
  assertCan(s.actor, data.scope === "org" ? "ai.settings" : "ai.use");
  if (data.model && !data.provider) throw new ModelSelectionError("Escolha o provedor do modelo.", "model_unavailable");
  if (data.provider) {
    const states = await providerStates(s);
    const state = states.find((p) => p.id === data.provider);
    if (!state) throw new ModelSelectionError("Provedor de IA desconhecido.", "model_unavailable");
    // Padrão pessoal pode apontar um modelo que só a chave pessoal da pessoa oferece.
    const personal = data.scope === "user" ? (await personalReadyModels(s)).get(data.provider) : undefined;
    const models = personal ? [...state.models, ...personal] : state.models;
    if (data.model) {
      const m = models.find((x) => x.id === data.model);
      if (!m)
        throw new ModelSelectionError(
          `O modelo ${data.model} não está disponível em ${state.label}.`,
          "model_unavailable",
        );
      if (data.task) {
        const c = compatibility(m, data.task as AiTask);
        if (!c.compatible) {
          throw new ModelSelectionError(incompatibilityMessage(m, data.task as AiTask, c), "model_incompatible");
        }
      }
    }
  }
  const userId = data.scope === "user" ? s.actor.userId : null;
  const values = {
    organizationId: s.actor.orgId,
    userId,
    module: data.module,
    task: data.task,
    provider: data.provider ?? null,
    model: data.model ?? null,
    priority: data.priority,
  };
  const scope = and(
    userId ? eq(aiModelPreferences.userId, userId) : isNull(aiModelPreferences.userId),
    eq(aiModelPreferences.module, data.module),
    eq(aiModelPreferences.task, data.task),
  );
  const [existing] = await s.db.select({ id: aiModelPreferences.id }).from(aiModelPreferences).where(scope);
  if (existing) {
    await s.db
      .update(aiModelPreferences)
      .set({ provider: values.provider, model: values.model, priority: values.priority })
      .where(eq(aiModelPreferences.id, existing.id));
  } else {
    await s.db.insert(aiModelPreferences).values(values);
  }
}

export async function deletePreference(s: Scope, raw: { scope: "org" | "user"; module?: string; task?: string }) {
  assertCan(s.actor, raw.scope === "org" ? "ai.settings" : "ai.use");
  await s.db
    .delete(aiModelPreferences)
    .where(
      and(
        raw.scope === "org" ? isNull(aiModelPreferences.userId) : eq(aiModelPreferences.userId, s.actor.userId),
        eq(aiModelPreferences.module, raw.module ?? ""),
        eq(aiModelPreferences.task, raw.task ?? ""),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* Resolução da escolha                                                */
/* ------------------------------------------------------------------ */

export type ResolvedSelection = {
  def: ProviderDef;
  /** Chave da API (somente no servidor). */
  apiKey: string | null;
  /** Endereço base da credencial pessoal (BYOK), quando houver. */
  baseUrl: string | null;
  /** De quem é a credencial: pessoal, da organização, do servidor ou nenhuma. */
  keySource: "user" | "org" | "env" | "none";
  model: AiModelInfo;
  source: PreferenceLevel | "explicit" | "auto";
  priority: AiPriority;
  /** Explicação simples da escolha. */
  reason: string;
  /** Avisos (ex.: capacidade não confirmada pelo provedor). */
  warnings: string[];
};

/**
 * Decide provedor e modelo para uma operação. Precedência: escolha explícita
 * > padrões da pessoa (tarefa, módulo, geral) > padrões da organização
 * (tarefa, módulo, geral) > automático. Um modelo indisponível ou
 * incompatível gera erro com alternativas — nunca uma troca silenciosa.
 */
export async function resolveSelection(
  s: Scope,
  ctx: { module: string; task: AiTask; selection?: z.input<typeof aiSelectionInput> },
): Promise<ResolvedSelection> {
  const selection: AiSelection = aiSelectionInput.parse(ctx.selection ?? {});
  const { ready, unavailable } = await readyProviders(s);
  const all = ready.flatMap((p) => p.models);
  const taskLabel = AI_TASKS[ctx.task].label;

  let provider: string | null = null;
  let modelId: string | null = null;
  let priority: AiPriority = selection.priority ?? "balanced";
  let source: ResolvedSelection["source"] = "auto";

  if (selection.mode === "manual") {
    provider = selection.provider ?? null;
    modelId = selection.model ?? null;
    source = "explicit";
    if (!provider)
      throw new ModelSelectionError(
        "Escolha o provedor de IA.",
        "model_unavailable",
        alternativesFor(all, ctx.task, priority),
      );
  } else if (selection.mode === "default") {
    const kind = AI_TASKS[ctx.task].kind;
    const known = new Map(all.map((m) => [`${m.provider}:${m.id}`, m]));
    // Um padrão geral de outro tipo (ex.: modelo de texto) não vale para esta tarefa.
    const applies = (p: AiPreference) => {
      if (!p.provider) return true;
      const d = providerDef(p.provider);
      if (d && !d.kinds.includes(kind)) return false;
      const m = p.model ? known.get(`${p.provider}:${p.model}`) : undefined;
      return !m || m.kind === kind;
    };
    const picked = pickPreference(await listPreferences(s), { module: ctx.module, task: ctx.task }, applies);
    if (picked) {
      provider = picked.pref.provider;
      modelId = picked.pref.model;
      priority = selection.priority ?? picked.pref.priority;
      source = picked.level;
    }
  }

  if (!all.length) {
    const why = unavailable.length ? ` (${unavailable.map((u) => `${u.label}: ${u.reason}`).join("; ")})` : "";
    throw new ModelSelectionError(
      `Nenhum provedor de IA está pronto para uso${why}. Configure em Configurações → Inteligência artificial.`,
      "no_provider",
    );
  }

  const describeSource = PREFERENCE_LEVEL_LABEL[source];

  if (provider) {
    const p = ready.find((x) => x.def.id === provider);
    const providerLabel = PROVIDER_LABEL[provider] ?? provider;
    if (!p) {
      const u = unavailable.find((x) => x.id === provider);
      throw new ModelSelectionError(
        `${providerLabel} não está disponível${u ? ` (${u.reason})` : ""}. Escolha outro modelo compatível.`,
        "model_unavailable",
        alternativesFor(all, ctx.task, priority),
      );
    }
    if (modelId) {
      const m = p.models.find((x) => x.id === modelId);
      if (!m) {
        throw new ModelSelectionError(
          `O modelo ${modelId} não está disponível na conta de ${providerLabel}.`,
          "model_unavailable",
          alternativesFor(all, ctx.task, priority, `${provider}:${modelId}`),
        );
      }
      const c = compatibility(m, ctx.task);
      if (!c.compatible) {
        throw new ModelSelectionError(
          incompatibilityMessage(m, ctx.task, c),
          "model_incompatible",
          alternativesFor(all, ctx.task, priority, `${provider}:${modelId}`),
        );
      }
      return {
        def: p.def,
        apiKey: p.key,
        baseUrl: p.baseUrl,
        keySource: p.keySource,
        model: m,
        source,
        priority,
        reason: `${m.label} (${providerLabel}) — ${describeSource}.`,
        warnings: c.unconfirmed.map((cap) => `${providerLabel} não confirma ${CAP_LABEL[cap]} para ${m.label}.`),
      };
    }
    const choice = autoSelect(p.models, ctx.task, priority);
    if (!choice) {
      throw new ModelSelectionError(
        `${providerLabel} não tem modelo habilitado compatível com "${taskLabel}".`,
        "no_compatible",
        alternativesFor(all, ctx.task, priority),
      );
    }
    const c = compatibility(choice.model, ctx.task);
    return {
      def: p.def,
      apiKey: p.key,
      baseUrl: p.baseUrl,
      keySource: p.keySource,
      model: choice.model,
      source,
      priority,
      reason: `${choice.reason} (${describeSource})`,
      warnings: c.unconfirmed.map(
        (cap) => `${providerLabel} não confirma ${CAP_LABEL[cap]} para ${choice.model.label}.`,
      ),
    };
  }

  const choice = autoSelect(all, ctx.task, priority);
  if (!choice) {
    const hint =
      AI_TASKS[ctx.task].kind === "image"
        ? " Configure um provedor com geração de imagens (OpenAI, modelos gpt-image) em Configurações → Inteligência artificial."
        : "";
    throw new ModelSelectionError(`Nenhum modelo habilitado é compatível com "${taskLabel}".${hint}`, "no_compatible");
  }
  const p = ready.find((x) => x.def.id === choice.model.provider)!;
  const c = compatibility(choice.model, ctx.task);
  return {
    def: p.def,
    apiKey: p.key,
    baseUrl: p.baseUrl,
    keySource: p.keySource,
    model: choice.model,
    source: source === "auto" ? "auto" : source,
    priority,
    reason: source === "auto" ? `Escolha automática: ${choice.reason}` : `${choice.reason} (${describeSource})`,
    warnings: c.unconfirmed.map(
      (cap) =>
        `${PROVIDER_LABEL[choice.model.provider] ?? choice.model.provider} não confirma ${CAP_LABEL[cap]} para ${choice.model.label}.`,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Dados do seletor (sem segredos)                                     */
/* ------------------------------------------------------------------ */

export type AiPickerData = {
  providers: {
    id: string;
    label: string;
    ready: boolean;
    status: string;
    reason: string | null;
    models: AiModelInfo[];
    /** Disponível pela chave pessoal da pessoa (BYOK), com precedência sobre a da organização. */
    personal?: boolean;
  }[];
  preferences: AiPreference[];
};

/**
 * Provedores, modelos e preferências para o componente de seleção (sem
 * segredos). Com `refresh`, valida antes as credenciais ainda não verificadas
 * ou com lista de modelos vencida, para mostrar só modelos realmente disponíveis.
 */
export async function getPickerData(s: Scope, opts: { refresh?: boolean } = {}): Promise<AiPickerData> {
  if (opts.refresh) await readyProviders(s);
  const [states, preferences, personal] = [
    await providerStates(s),
    await listPreferences(s),
    await personalReadyModels(s),
  ];
  return {
    providers: states
      .filter((p) => p.enabled || p.keySource !== "none" || personal.has(p.id))
      .map((p) => {
        const mine = personal.get(p.id);
        if (mine) {
          return {
            id: p.id,
            label: p.label,
            ready: true,
            status: "valid",
            reason: null,
            models: mine.filter((m) => !m.deprecated),
            personal: true,
          };
        }
        return {
          id: p.id,
          label: p.label,
          ready: p.ready,
          status: p.status,
          reason: !p.enabled ? "desabilitado" : p.ready ? null : (p.lastError ?? "credencial ainda não validada"),
          models: p.ready ? p.models.filter((m) => !m.deprecated) : [],
        };
      }),
    preferences,
  };
}
