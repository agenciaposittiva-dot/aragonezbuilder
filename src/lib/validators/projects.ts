import { z } from "zod";
import { isoDate, moneyCents, optionalText, optionalUuid, priorityEnum, requiredText, uuid } from "./common";

export const projectInput = z
  .object({
    clientId: uuid,
    name: requiredText("o nome", 160),
    description: optionalText(10000),
    objective: optionalText(3000),
    ownerMembershipId: optionalUuid,
    statusId: optionalUuid,
    priority: priorityEnum.default("medium"),
    startDate: isoDate,
    dueDate: isoDate,
    budget: moneyCents,
    memberIds: z.array(uuid).max(50).default([]),
    stages: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  })
  .refine((d) => !d.startDate || !d.dueDate || d.startDate <= d.dueDate, {
    message: "O prazo deve ser depois do início",
    path: ["dueDate"],
  });
export type ProjectInput = z.input<typeof projectInput>;

export const projectUpdateInput = z
  .object({
    id: uuid,
    name: requiredText("o nome", 160),
    description: optionalText(10000),
    objective: optionalText(3000),
    ownerMembershipId: optionalUuid,
    priority: priorityEnum,
    startDate: isoDate,
    dueDate: isoDate,
    budget: moneyCents.optional(),
  })
  .refine((d) => !d.startDate || !d.dueDate || d.startDate <= d.dueDate, {
    message: "O prazo deve ser depois do início",
    path: ["dueDate"],
  });

export const projectListParams = z.object({
  q: z.string().trim().max(100).optional(),
  clientId: z.uuid().optional(),
  statusId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
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
  view: z.enum(["list", "board", "calendar", "timeline"]).default("list"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(25),
});

export const DEFAULT_STAGES = ["Planejamento", "Criação", "Revisão interna", "Aprovação do cliente", "Entrega"];

export const stageInput = z.object({
  id: optionalUuid,
  projectId: uuid,
  name: requiredText("o nome da etapa", 80),
  dueDate: isoDate,
});
