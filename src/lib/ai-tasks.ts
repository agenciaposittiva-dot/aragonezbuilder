/*
 * Catálogo de tarefas, módulos e prioridades de IA (compartilhado entre
 * servidor e interface). As capacidades exigidas por tarefa decidem quais
 * modelos são compatíveis; o servidor sempre revalida a escolha.
 */

export type Capability = "yes" | "no" | "unknown";
export type ModelKind = "text" | "image";
export type ModelTier = "fast" | "balanced" | "quality" | "unknown";

export type ModelCaps = {
  /** Gera texto (chat/mensagens). */
  text: Capability;
  /** Aceita imagens na entrada (análise de referências). */
  imageInput: Capability;
  /** Gera imagens. */
  imageOutput: Capability;
  /** Saída estruturada (JSON). */
  structured: Capability;
  /** Controle de esforço de raciocínio (Anthropic `effort`). */
  effort: Capability;
};

export type AiModelInfo = {
  id: string;
  label: string;
  provider: string;
  kind: ModelKind;
  caps: ModelCaps;
  tier: ModelTier;
  /** De onde veio a classificação de velocidade/qualidade. */
  tierSource: "api" | "nome" | "desconhecida";
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  /** Data de lançamento informada pelo provedor (ISO), quando houver. */
  createdAt: string | null;
  deprecated: boolean;
  /** Preço de tabela por milhão de tokens (US$), só quando conhecido. */
  price: { input: number; output: number } | null;
};

export const AI_PRIORITIES = {
  balanced: "Equilíbrio",
  quality: "Qualidade",
  speed: "Rapidez",
  cost: "Menor custo",
} as const;
export type AiPriority = keyof typeof AI_PRIORITIES;

type CapNeed = Partial<Record<keyof ModelCaps, "required" | "preferred">>;

export const AI_TASKS = {
  text: { label: "Texto geral", kind: "text", needs: { text: "required" } },
  copy: { label: "Criar copy", kind: "text", needs: { text: "required" } },
  captions: { label: "Legendas", kind: "text", needs: { text: "required" } },
  planning: { label: "Planejar campanhas", kind: "text", needs: { text: "required" } },
  summary: { label: "Resumos", kind: "text", needs: { text: "required" } },
  structured: {
    label: "Sugestões estruturadas (tarefas)",
    kind: "text",
    needs: { text: "required", structured: "preferred" },
  },
  trend_analysis: { label: "Analisar tendências", kind: "text", needs: { text: "required" } },
  reference_analysis: {
    label: "Analisar referências (JPG/PNG)",
    kind: "text",
    needs: { text: "required", imageInput: "required" },
  },
  image_generation: { label: "Gerar imagens", kind: "image", needs: { imageOutput: "required" } },
  chat: { label: "Conversa / copiloto", kind: "text", needs: { text: "required" } },
  task_planning: {
    label: "Planejar tarefas (criar, quebrar, converter demandas)",
    kind: "text",
    needs: { text: "required", structured: "preferred" },
  },
  task_review: {
    label: "Revisar tarefas (prioridade, prazo, resumo de comentários)",
    kind: "text",
    needs: { text: "required", structured: "preferred" },
  },
} as const satisfies Record<string, { label: string; kind: ModelKind; needs: CapNeed }>;
export type AiTask = keyof typeof AI_TASKS;

export const AI_MODULES = {
  assistant: "Assistente IA",
  copilot: "Copiloto geral",
  editor: "Editor gráfico",
  art: "Gerador de artes",
  copy: "Criação de copy",
  captions: "Legendas",
  carousel: "Carrosséis",
  planning: "Planejamento",
  trends: "Tendências",
  reports: "Relatórios",
  tasks: "Tarefas",
  chat: "Chat da equipe",
  preview: "Pré-visualização",
} as const;
export type AiModule = keyof typeof AI_MODULES;

/** Tarefa de cada operação do Assistente IA (src/lib/ai-operations.ts). */
const OPERATION_TASK: Record<string, AiTask> = {
  campaign_ideas: "planning",
  content_strategy: "planning",
  editorial_calendar: "planning",
  briefing: "planning",
  proposal: "copy",
  captions: "captions",
  headlines: "copy",
  ctas: "copy",
  script: "copy",
  variations: "copy",
  copy_review: "copy",
  creative_suggestions: "copy",
  summary: "summary",
  task_suggestions: "structured",
  image: "image_generation",
  // Assistente da Central de Tarefas (src/server/services/task-ai.ts).
  task_plan: "task_planning",
  task_demand: "task_planning",
  task_breakdown: "task_planning",
  task_triage: "task_review",
  task_comment_summary: "task_review",
  chat_summary: "summary",
  chat_catch_up: "summary",
  chat_decisions: "summary",
  chat_tasks: "structured",
  chat_reply: "chat",
  chat_rewrite: "chat",
  chat_ask: "chat",
  // Central de pré-visualização (src/server/services/preview-ai.ts).
  preview_review: "copy",
  preview_convert: "copy",
};

export function operationTask(operation: string): AiTask {
  return OPERATION_TASK[operation] ?? "text";
}

export const CAP_LABEL: Record<keyof ModelCaps, string> = {
  text: "texto",
  imageInput: "leitura de imagens",
  imageOutput: "geração de imagens",
  structured: "saída estruturada",
  effort: "controle de esforço",
};

/* ------------------------------------------------------------------ */
/* Compatibilidade                                                     */
/* ------------------------------------------------------------------ */

export type Compatibility = {
  compatible: boolean;
  /** Capacidades exigidas que o provedor não confirma (permitido, com aviso). */
  unconfirmed: (keyof ModelCaps)[];
  /** Capacidades exigidas que o modelo não tem. */
  missing: (keyof ModelCaps)[];
};

export function compatibility(model: Pick<AiModelInfo, "caps" | "kind">, task: AiTask): Compatibility {
  const def = AI_TASKS[task];
  const unconfirmed: (keyof ModelCaps)[] = [];
  const missing: (keyof ModelCaps)[] = [];
  if (model.kind !== def.kind) {
    return { compatible: false, unconfirmed, missing: def.kind === "image" ? ["imageOutput"] : ["text"] };
  }
  for (const [cap, level] of Object.entries(def.needs) as [keyof ModelCaps, "required" | "preferred"][]) {
    const v = model.caps[cap];
    if (v === "no" && level === "required") missing.push(cap);
    else if (v !== "yes") unconfirmed.push(cap);
  }
  return { compatible: missing.length === 0, unconfirmed, missing };
}

export function incompatibilityMessage(model: Pick<AiModelInfo, "label">, task: AiTask, c: Compatibility) {
  const caps = c.missing.map((m) => CAP_LABEL[m]).join(", ");
  return `${model.label} não oferece ${caps}, necessário para "${AI_TASKS[task].label}".`;
}
