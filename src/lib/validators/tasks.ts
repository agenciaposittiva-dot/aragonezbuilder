import { z } from "zod";
import { isoDate, optionalText, optionalUuid, priorityEnum, requiredText, uuid } from "./common";

const estimate = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      ctx.addIssue({ code: "custom", message: "Estimativa inválida" });
      return z.NEVER;
    }
    return Math.round(n);
  });

export const taskInput = z
  .object({
    projectId: uuid,
    title: requiredText("o título", 300),
    description: optionalText(20000),
    stageId: optionalUuid,
    statusId: optionalUuid,
    priority: priorityEnum.default("medium"),
    assigneeMembershipId: optionalUuid,
    collaboratorIds: z.array(uuid).max(30).default([]),
    startDate: isoDate,
    dueDate: isoDate,
    /** Estimativa em minutos. */
    estimateMinutes: estimate,
    parentTaskId: optionalUuid,
    requestId: optionalUuid,
  })
  .refine((d) => !d.startDate || !d.dueDate || d.startDate <= d.dueDate, {
    message: "O prazo deve ser depois do início",
    path: ["dueDate"],
  });
export type TaskInput = z.input<typeof taskInput>;

/** Atualização parcial: só os campos enviados são alterados. */
export const taskUpdateInput = z
  .object({
    id: uuid,
    title: requiredText("o título", 300).optional(),
    description: optionalText(20000),
    stageId: optionalUuid,
    priority: priorityEnum.optional(),
    assigneeMembershipId: optionalUuid,
    startDate: isoDate,
    dueDate: isoDate,
    estimateMinutes: estimate,
  })
  .partial({
    description: true,
    stageId: true,
    assigneeMembershipId: true,
    startDate: true,
    dueDate: true,
    estimateMinutes: true,
  });
export type TaskUpdateInput = z.input<typeof taskUpdateInput>;

export const taskListParams = z.object({
  q: z.string().trim().max(100).optional(),
  projectId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  /** id de vínculo, "me" (eu) ou "none" (sem responsável) */
  assignee: z.union([z.uuid(), z.literal("me"), z.literal("none")]).optional(),
  statusId: z.uuid().optional(),
  priority: priorityEnum.optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  archived: z.coerce.boolean().optional(),
  /** Incluir subtarefas na listagem (padrão: só tarefas principais). */
  subtasks: z.coerce.boolean().optional(),
  /** Atalhos de prazo: vencidas, para hoje, próximos 7 dias ou sem prazo (abertas). */
  due: z.enum(["overdue", "today", "week", "none"]).optional(),
  /** Só tarefas abertas (não concluídas). */
  open: z.coerce.boolean().optional(),
  /** Só tarefas bloqueadas por dependências abertas. */
  blocked: z.coerce.boolean().optional(),
  /** Ordenação da lista (padrão: status e prazo). */
  sort: z.enum(["status", "due", "priority", "recent", "title", "focus"]).optional(),
  /** Concluídas a partir desta data (AAAA-MM-DD). */
  completedSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Só tarefas com esta etiqueta. */
  label: z.uuid().optional(),
  view: z.enum(["my", "list", "board", "calendar", "timeline", "focus"]).default("list"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});
export type TaskListParams = z.input<typeof taskListParams>;

/** Parâmetros da URL que um filtro salvo pode guardar (os demais são descartados). */
export const SAVED_VIEW_KEYS = [
  "q",
  "projectId",
  "clientId",
  "assignee",
  "statusId",
  "priority",
  "from",
  "to",
  "due",
  "open",
  "blocked",
  "sort",
  "label",
  "view",
  "group",
  "cal",
] as const;

export const savedViewInput = z.object({
  name: requiredText("o nome do filtro", 60),
  /** Busca da URL (ex.: "view=list&due=overdue"). */
  query: z.string().max(1000),
});

/* Etiquetas ---------------------------------------------------------- */

export const LABEL_COLORS = [
  "slate",
  "zinc",
  "blue",
  "sky",
  "amber",
  "orange",
  "violet",
  "pink",
  "green",
  "teal",
  "red",
] as const;

export const labelInput = z.object({
  id: optionalUuid,
  name: requiredText("o nome da etiqueta", 40),
  color: z.enum(LABEL_COLORS).default("blue"),
});

/* Modelos ------------------------------------------------------------ */

const offsetDays = z.coerce
  .number()
  .int("Use dias inteiros")
  .min(0, "O deslocamento não pode ser negativo")
  .max(365, "Use no máximo 365 dias")
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? null : v));
const checklistTitles = (max: number) =>
  z.array(z.string().trim().min(1).max(300)).max(max, `No máximo ${max} itens`).default([]);

export const templateInput = z.object({
  id: optionalUuid,
  name: requiredText("o nome do modelo", 120),
  description: optionalText(2000),
  priority: priorityEnum.default("medium"),
  dueOffsetDays: offsetDays,
  estimateMinutes: estimate,
  checklist: checklistTitles(50),
  steps: z
    .array(
      z.object({
        title: requiredText("o nome da etapa", 300),
        dueOffsetDays: offsetDays,
        estimateMinutes: estimate,
        checklist: checklistTitles(30),
      }),
    )
    .max(40, "No máximo 40 etapas")
    .default([]),
});
export type TemplateInput = z.input<typeof templateInput>;

export const applyTemplateInput = z.object({
  templateId: uuid,
  projectId: uuid,
  /** Título da tarefa principal (padrão: nome do modelo). */
  title: optionalText(300),
  /** Data base dos prazos (padrão: hoje). */
  startDate: isoDate,
  assigneeMembershipId: optionalUuid,
});

export const taskMoveInput = z.object({
  id: uuid,
  statusId: uuid,
  beforeId: optionalUuid,
  afterId: optionalUuid,
});

export const checklistItemInput = z.object({
  taskId: uuid,
  id: optionalUuid,
  title: requiredText("o item", 300),
});

export const timeEntryInput = z
  .object({
    taskId: uuid,
    /** Data do trabalho (YYYY-MM-DD). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
    minutes: z.coerce
      .number()
      .int()
      .min(1, "Informe a duração")
      .max(24 * 60, "Máximo de 24 horas por registro"),
    note: optionalText(500),
    billable: z.boolean().default(true),
  })
  .strict();

/** "1h30", "1:30", "90", "1,5h" → minutos */
export function parseDuration(input: string): number | null {
  const v = input.trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
  if (!v) return null;
  const hm = v.match(/^(\d+):(\d{1,2})$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  // "2h", "1.5h", "1h30", "1h30min", "45min", "45m"
  const withHours = v.match(/^(\d+(?:\.\d+)?)h(?:(\d{1,2})(?:m|min)?)?$/);
  if (withHours) return Math.round(Number(withHours[1]) * 60 + Number(withHours[2] ?? 0));
  const minutesOnly = v.match(/^(\d+)(?:m|min)$/);
  if (minutesOnly) return Number(minutesOnly[1]);
  // número puro = minutos
  if (/^\d+$/.test(v)) return Number(v);
  return null;
}

/* Rotina (tarefas recorrentes) --------------------------------------- */

export const ROUTINE_FREQUENCY_LABEL = { daily: "Diária", weekly: "Semanal", monthly: "Mensal" } as const;

export const routineInput = z
  .object({
    id: optionalUuid,
    projectId: uuid,
    title: requiredText("o título", 300),
    description: optionalText(5000),
    assigneeMembershipId: optionalUuid,
    priority: priorityEnum.default("medium"),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.coerce.number().int().min(1, "Mínimo 1").max(12, "Máximo 12").default(1),
    weekday: z.coerce.number().int().min(0).max(6).nullable().optional(),
    monthday: z.coerce.number().int().min(1, "Use de 1 a 28").max(28, "Use de 1 a 28").nullable().optional(),
    dueInDays: z.coerce.number().int().min(0).max(60, "No máximo 60 dias").default(0),
    /** Primeira data possível (padrão: hoje). */
    startOn: isoDate,
  })
  .refine((d) => d.frequency !== "weekly" || d.weekday !== null && d.weekday !== undefined, {
    message: "Escolha o dia da semana",
    path: ["weekday"],
  })
  .refine((d) => d.frequency !== "monthly" || !!d.monthday, {
    message: "Escolha o dia do mês",
    path: ["monthday"],
  });
