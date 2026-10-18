import { z } from "zod";
import { EVENT_CATALOG } from "@/lib/events";

export const CONDITION_OPS = ["eq", "neq", "in", "contains", "gt", "lt", "exists"] as const;
export const CONDITION_OP_LABEL: Record<(typeof CONDITION_OPS)[number], string> = {
  eq: "é igual a",
  neq: "é diferente de",
  in: "é um destes",
  contains: "contém",
  gt: "é maior que",
  lt: "é menor que",
  exists: "está preenchido",
};

export const ACTION_TYPES = [
  "notify_members",
  "notify_client",
  "email",
  "create_task",
  "set_task_status",
  "webhook",
] as const;
export const ACTION_LABEL: Record<(typeof ACTION_TYPES)[number], string> = {
  notify_members: "Notificar a equipe",
  notify_client: "Notificar o cliente",
  email: "Enviar e-mail",
  create_task: "Criar tarefa",
  set_task_status: "Mudar status da tarefa",
  webhook: "Chamar webhook",
};

const text = (label: string, max: number) => z.string().trim().min(1, `Informe ${label}`).max(max);

export const conditionSchema = z.object({
  field: z.string().trim().min(1, "Escolha o campo").max(60),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(100)).max(30)]).optional(),
});

export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("notify_members"),
      membershipIds: z.array(z.uuid()).max(50).optional(),
      roleKeys: z.array(z.string().max(40)).max(20).optional(),
      toAssignee: z.boolean().optional(),
      toOwner: z.boolean().optional(),
      title: text("o título da notificação", 200),
      body: z.string().trim().max(1000).optional(),
    })
    .refine((a) => (a.membershipIds?.length ?? 0) + (a.roleKeys?.length ?? 0) > 0 || a.toAssignee || a.toOwner, {
      message: "Escolha quem será notificado",
      path: ["membershipIds"],
    }),
  z.object({
    type: z.literal("notify_client"),
    title: text("o título da notificação", 200),
    body: z.string().trim().max(1000).optional(),
    email: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("email"),
    to: z.enum(["assignee", "owner", "client_users"]),
    subject: text("o assunto", 200),
    body: text("a mensagem", 5000),
  }),
  z.object({
    type: z.literal("create_task"),
    title: text("o título da tarefa", 200),
    description: z.string().trim().max(5000).optional(),
    assigneeMembershipId: z.uuid().optional(),
    dueInDays: z.number().int().min(0).max(365).optional(),
  }),
  z.object({ type: z.literal("set_task_status"), statusKey: text("o status", 80) }),
  z.object({ type: z.literal("webhook"), url: z.url("URL inválida").max(500) }),
]);

export type ActionInput = z.input<typeof actionSchema>;
export type ConditionInput = z.input<typeof conditionSchema>;

export const ruleInput = z.object({
  id: z.uuid().optional(),
  name: text("o nome", 120),
  description: z.string().trim().max(500).optional().nullable(),
  trigger: z.string().refine((t) => t in EVENT_CATALOG, "Gatilho inválido"),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1, "Adicione pelo menos uma ação").max(10),
  enabled: z.boolean().default(true),
});
export type RuleInput = z.input<typeof ruleInput>;
