import { z } from "zod";

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/*
 * Assistente de IA da Central de Tarefas (compartilhado entre servidor e
 * interface). A IA só propõe: tudo passa por uma prévia editável e por uma
 * confirmação explícita antes de gravar qualquer registro.
 */

export const TASK_AI_MODES = {
  plan: { operation: "task_plan", label: "Criar tarefas a partir de um texto", task: "task_planning" },
  demand: { operation: "task_demand", label: "Converter solicitação em tarefas", task: "task_planning" },
  breakdown: { operation: "task_breakdown", label: "Quebrar em subtarefas e checklist", task: "task_planning" },
  triage: { operation: "task_triage", label: "Sugerir prioridade e prazo", task: "task_review" },
  summary: { operation: "task_comment_summary", label: "Resumir comentários", task: "task_review" },
} as const;
export type TaskAiMode = keyof typeof TASK_AI_MODES;

/** Rótulo de uma operação do assistente de tarefas (histórico de gerações). */
export function taskAiOperationLabel(operation: string): string | undefined {
  return Object.values(TASK_AI_MODES).find((m) => m.operation === operation)?.label;
}

/** De onde veio a data: citada no texto, pedida na solicitação ou só sugerida pela IA. */
export type DueOrigin = "texto" | "solicitacao" | "sugestao";

export const DUE_ORIGIN_LABEL: Record<DueOrigin, string> = {
  texto: "Data citada no texto",
  solicitacao: "Prazo desejado na solicitação",
  sugestao: "Sugestão da IA — não é prazo combinado",
};

export type PlanItem = {
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  dueOrigin: DueOrigin | null;
  /** Nome citado pela IA e a pessoa da equipe correspondente (quando encontrada). */
  assigneeHint: string;
  assigneeMembershipId: string | null;
  estimateMinutes: number | null;
  subtasks: string[];
  checklist: string[];
};

export type TaskAiResult =
  | { mode: "plan" | "demand"; items: PlanItem[]; projectId: string | null; requestId: string | null }
  | {
      mode: "breakdown";
      taskId: string;
      subtasks: { title: string; estimateMinutes: number | null }[];
      checklist: string[];
    }
  | {
      mode: "triage";
      taskId: string;
      current: { priority: Priority; dueDate: string | null };
      priority: Priority;
      priorityReason: string;
      dueDate: string | null;
      dueReason: string;
    }
  | { mode: "summary"; taskId: string; summary: string; decisions: string[]; pending: string[]; commentCount: number };

/* ------------------------------------------------------------------ */
/* Pedidos                                                             */
/* ------------------------------------------------------------------ */

const common = {
  selection: z.unknown().optional(),
  confirmCost: z.boolean().optional(),
};

export const taskAiRequest = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("plan"),
    text: z.string().trim().min(3, "Descreva o que precisa ser feito").max(6000),
    projectId: z.uuid().nullable().optional(),
    ...common,
  }),
  z.object({ mode: z.literal("demand"), requestId: z.uuid(), ...common }),
  z.object({
    mode: z.literal("breakdown"),
    taskId: z.uuid(),
    notes: z.string().trim().max(2000).default(""),
    ...common,
  }),
  z.object({ mode: z.literal("triage"), taskId: z.uuid(), ...common }),
  z.object({ mode: z.literal("summary"), taskId: z.uuid(), ...common }),
]);
export type TaskAiRequest = z.input<typeof taskAiRequest>;

const title = z.string().trim().min(1, "Informe o título").max(200);
const shortList = (max: number) => z.array(z.string().trim().min(1).max(200)).max(max).default([]);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

export const applyPlanInput = z.object({
  projectId: z.uuid({ error: "Escolha o projeto" }),
  requestId: z.uuid().nullable().optional(),
  tasks: z
    .array(
      z.object({
        title,
        description: z.string().trim().max(4000).default(""),
        priority: z.enum(PRIORITIES).default("medium"),
        dueDate: isoDate,
        assigneeMembershipId: z.uuid().nullable().optional(),
        estimateMinutes: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
        subtasks: shortList(15),
        checklist: shortList(20),
      }),
    )
    .min(1, "Selecione pelo menos uma tarefa")
    .max(20),
});
export type ApplyPlanInput = z.input<typeof applyPlanInput>;

export const applyBreakdownInput = z
  .object({
    taskId: z.uuid(),
    subtasks: z
      .array(
        z.object({
          title,
          estimateMinutes: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
        }),
      )
      .max(20)
      .default([]),
    checklist: shortList(30),
  })
  .refine((d) => d.subtasks.length + d.checklist.length > 0, "Selecione pelo menos uma subtarefa ou item.");

/* ------------------------------------------------------------------ */
/* Datas citadas (proteção contra prazos inventados)                   */
/* ------------------------------------------------------------------ */

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Ano para "dd/mm" sem ano: o deste ano, ou o próximo se a data já passou. */
function withYear(today: string, m: number, d: number) {
  const year = Number(today.slice(0, 4));
  const iso = validDate(year, m, d);
  if (!iso) return null;
  return iso < today ? validDate(year + 1, m, d) : iso;
}

/**
 * Datas que o texto realmente cita (dd/mm, dd/mm/aaaa, aaaa-mm-dd, "12 de
 * março", hoje, amanhã e dias da semana). Uma data devolvida pela IA só é
 * tratada como combinada quando aparece aqui; as demais são sugestões.
 */
export function citedDates(text: string, today: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) out.add(iso);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const iso = m[3]
      ? validDate(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mo, d)
      : withYear(today, mo, d);
    if (iso) out.add(iso);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/g)) {
    const mo = MONTHS.indexOf(m[2]!) + 1;
    if (!mo) continue;
    const iso = m[3] ? validDate(Number(m[3]), mo, Number(m[1])) : withYear(today, mo, Number(m[1]));
    if (iso) out.add(iso);
  }
  if (/\bhoje\b/.test(t)) out.add(today);
  if (/(?<!\p{L})amanh[ãa](?!\p{L})/u.test(t)) out.add(addDays(today, 1));
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  WEEKDAYS.forEach((name, dow) => {
    if (!new RegExp(`\\b${name}`).test(t)) return;
    const ahead = (dow - todayDow + 7) % 7;
    out.add(addDays(today, ahead));
    out.add(addDays(today, ahead + 7));
  });
  return out;
}
