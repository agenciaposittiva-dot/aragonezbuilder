import {
  AI_PRIORITIES,
  AI_TASKS,
  compatibility,
  incompatibilityMessage,
  type AiModelInfo,
  type AiPriority,
  type AiTask,
  type ModelTier,
} from "./ai-tasks";

/*
 * Regras de escolha de modelo (puras, usadas na interface e no servidor).
 * O servidor sempre refaz a escolha com os modelos realmente habilitados.
 */

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  gemini: "Google Gemini",
  demo: "Demonstração local (sem IA real)",
};

/** Escolha feita na interface para uma operação. */
export type AiSelection = {
  /** default = usar a preferência salva; auto = escolher automaticamente; manual = provedor/modelo explícitos. */
  mode: "default" | "auto" | "manual";
  provider?: string | null;
  model?: string | null;
  priority?: AiPriority;
};

/** Preferência persistida (organização ou pessoa; módulo e tarefa vazios = qualquer). */
export type AiPreference = {
  scope: "org" | "user";
  module: string;
  task: string;
  provider: string | null;
  model: string | null;
  priority: AiPriority;
};

export type PreferenceLevel = "user_task" | "user_module" | "user" | "org_task" | "org_module" | "org";

export const PREFERENCE_LEVEL_LABEL: Record<PreferenceLevel | "explicit" | "auto", string> = {
  explicit: "escolha desta operação",
  user_task: "seu padrão para esta tarefa",
  user_module: "seu padrão para este módulo",
  user: "seu padrão geral",
  org_task: "padrão da organização para esta tarefa",
  org_module: "padrão da organização para este módulo",
  org: "padrão da organização",
  auto: "escolha automática",
};

/**
 * Precedência: escolha explícita > pessoa+tarefa > pessoa+módulo > pessoa >
 * organização+tarefa > organização+módulo > organização > automático.
 * `applies` permite ignorar padrões gerais que não servem para a tarefa (ex.:
 * um modelo de texto como padrão geral não vale para gerar imagens); padrões
 * definidos para a própria tarefa sempre valem.
 */
export function pickPreference(
  prefs: AiPreference[],
  ctx: { module: string; task: string },
  applies: (p: AiPreference) => boolean = () => true,
): { pref: AiPreference; level: PreferenceLevel } | null {
  const order: [PreferenceLevel, (p: AiPreference) => boolean][] = [
    ["user_task", (p) => p.scope === "user" && p.task === ctx.task && (p.module === "" || p.module === ctx.module)],
    ["user_module", (p) => p.scope === "user" && p.task === "" && p.module === ctx.module],
    ["user", (p) => p.scope === "user" && p.task === "" && p.module === ""],
    ["org_task", (p) => p.scope === "org" && p.task === ctx.task && (p.module === "" || p.module === ctx.module)],
    ["org_module", (p) => p.scope === "org" && p.task === "" && p.module === ctx.module],
    ["org", (p) => p.scope === "org" && p.task === "" && p.module === ""],
  ];
  for (const [level, match] of order) {
    const taskLevel = level === "user_task" || level === "org_task";
    const found = prefs
      .filter((p) => match(p) && (taskLevel || applies(p)))
      .sort((a, b) => Number(b.module !== "") - Number(a.module !== ""))[0];
    if (found) return { pref: found, level };
  }
  return null;
}

const TIER_SCORE: Record<AiPriority, Record<ModelTier, number>> = {
  quality: { quality: 3, balanced: 2, fast: 1, unknown: 1.5 },
  speed: { fast: 3, balanced: 2, quality: 1, unknown: 1.5 },
  cost: { fast: 3, balanced: 2, quality: 1, unknown: 1.5 },
  balanced: { balanced: 3, quality: 2.2, fast: 2, unknown: 1.5 },
};

const PROVIDER_ORDER = ["anthropic", "openai", "gemini", "demo"];

/** Custo de referência (US$ por milhão, média entrada/saída) quando o preço é conhecido. */
function blendedPrice(m: AiModelInfo) {
  return m.price ? (m.price.input + m.price.output * 3) / 4 : null;
}

export type AutoChoice = { model: AiModelInfo; reason: string };

/**
 * Escolhe automaticamente entre os modelos compatíveis e disponíveis.
 * Preferência por capacidades confirmadas pelo provedor; depois prioridade
 * (qualidade, rapidez, custo ou equilíbrio); empate: o mais recente.
 */
export function autoSelect(models: AiModelInfo[], task: AiTask, priority: AiPriority = "balanced"): AutoChoice | null {
  const candidates = models
    .filter((m) => !m.deprecated)
    .map((m) => ({ m, c: compatibility(m, task) }))
    .filter((x) => x.c.compatible);
  if (!candidates.length) return null;

  const prices = candidates.map((x) => blendedPrice(x.m)).filter((p): p is number => p !== null);
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const scored = candidates.map(({ m, c }) => {
    let score = c.unconfirmed.length === 0 ? 100 : 0;
    const price = blendedPrice(m);
    if (priority === "cost" && price !== null && maxPrice > 0) score += 3 * (1 - price / maxPrice) + 0.5;
    else score += TIER_SCORE[priority][m.tier];
    return { m, c, score };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.m.createdAt ?? "").localeCompare(a.m.createdAt ?? "") ||
      PROVIDER_ORDER.indexOf(a.m.provider) - PROVIDER_ORDER.indexOf(b.m.provider),
  );
  const best = scored[0]!;
  const why: string[] = [];
  why.push(`compatível com "${AI_TASKS[task].label}"`);
  if (priority === "cost" && best.m.price) why.push("menor custo de tabela entre os compatíveis");
  else if (best.m.tier !== "unknown") {
    const tierText = {
      fast: "modelo rápido e econômico",
      balanced: "equilíbrio entre qualidade e custo",
      quality: "maior qualidade",
    }[best.m.tier];
    why.push(`${tierText} para a prioridade "${AI_PRIORITIES[priority]}"`);
    if (best.m.tierSource === "nome") why.push("classificação estimada pelo nome do modelo");
  }
  if (best.c.unconfirmed.length) why.push("algumas capacidades não são confirmadas pelo provedor");
  return {
    model: best.m,
    reason: `${best.m.label} (${PROVIDER_LABEL[best.m.provider] ?? best.m.provider}): ${why.join("; ")}.`,
  };
}

/** Modelos compatíveis com a tarefa (para sugerir alternativas). */
export function compatibleModels(models: AiModelInfo[], task: AiTask) {
  return models.filter((m) => !m.deprecated && compatibility(m, task).compatible);
}

/** Provedor como a interface o recebe (sem segredos). */
export type PickerProvider = {
  id: string;
  label: string;
  ready: boolean;
  reason: string | null;
  models: AiModelInfo[];
};

export type SelectionPreview = {
  model: AiModelInfo | null;
  source: PreferenceLevel | "explicit" | "auto";
  /** Explicação curta da escolha (ou do problema). */
  reason: string;
  /** Escolha que o servidor vai recusar (indisponível ou incompatível). */
  problem: boolean;
};

/**
 * Prévia, na interface, do modelo que será usado — mesmas regras do servidor,
 * que sempre revalida com os modelos realmente habilitados.
 */
export function previewSelection(
  providers: PickerProvider[],
  prefs: AiPreference[],
  ctx: { module: string; task: AiTask; selection: AiSelection },
): SelectionPreview {
  const ready = providers.filter((p) => p.ready);
  const all = ready.flatMap((p) => p.models);
  const kind = AI_TASKS[ctx.task].kind;
  let provider: string | null = null;
  let modelId: string | null = null;
  let level: SelectionPreview["source"] = "auto";
  let priority: AiPriority = ctx.selection.priority ?? "balanced";

  if (ctx.selection.mode === "manual") {
    provider = ctx.selection.provider ?? null;
    modelId = ctx.selection.model ?? null;
    level = "explicit";
  } else if (ctx.selection.mode === "default") {
    const known = new Map(all.map((m) => [`${m.provider}:${m.id}`, m]));
    const picked = pickPreference(prefs, ctx, (p) => {
      if (!p.provider) return true;
      const models = providers.find((x) => x.id === p.provider)?.models ?? [];
      if (models.length && !models.some((m) => m.kind === kind)) return false;
      const m = p.model ? known.get(`${p.provider}:${p.model}`) : undefined;
      return !m || m.kind === kind;
    });
    if (picked) {
      provider = picked.pref.provider;
      modelId = picked.pref.model;
      priority = ctx.selection.priority ?? picked.pref.priority;
      level = picked.level;
    }
  }

  const sourceText = PREFERENCE_LEVEL_LABEL[level];
  const fail = (reason: string, model: AiModelInfo | null = null): SelectionPreview => ({
    model,
    source: level,
    reason,
    problem: true,
  });
  if (!all.length) return fail("Nenhum provedor de IA está pronto para uso.");

  if (provider) {
    const p = ready.find((x) => x.id === provider);
    const label = PROVIDER_LABEL[provider] ?? provider;
    if (!p) {
      const why = providers.find((x) => x.id === provider)?.reason;
      return fail(`${label} não está disponível${why ? ` (${why})` : ""} — ${sourceText}.`);
    }
    if (modelId) {
      const m = p.models.find((x) => x.id === modelId);
      if (!m) return fail(`O modelo ${modelId} não está disponível — ${sourceText}.`);
      const c = compatibility(m, ctx.task);
      if (!c.compatible) return fail(incompatibilityMessage(m, ctx.task, c), m);
      return { model: m, source: level, reason: `${m.label} (${label}) — ${sourceText}.`, problem: false };
    }
    const choice = autoSelect(p.models, ctx.task, priority);
    if (!choice) return fail(`${label} não tem modelo compatível com "${AI_TASKS[ctx.task].label}".`);
    return { model: choice.model, source: level, reason: `${choice.reason} (${sourceText})`, problem: false };
  }

  const choice = autoSelect(all, ctx.task, priority);
  if (!choice) return fail(`Nenhum modelo habilitado é compatível com "${AI_TASKS[ctx.task].label}".`);
  return {
    model: choice.model,
    source: level,
    reason: level === "auto" ? `Escolha automática: ${choice.reason}` : `${choice.reason} (${sourceText})`,
    problem: false,
  };
}
