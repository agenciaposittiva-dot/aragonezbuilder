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
  view: z.enum(["list", "board", "calendar"]).default("list"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});
export type TaskListParams = z.input<typeof taskListParams>;

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
