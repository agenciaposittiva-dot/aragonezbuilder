import type { RuleInput } from "@/lib/validators/automations";

/** Modelos prontos de automação (o usuário revisa antes de salvar). */
export const AUTOMATION_PRESETS: { key: string; title: string; description: string; rule: Omit<RuleInput, "id"> }[] = [
  {
    key: "client-approval",
    title: "Avisar o cliente quando houver aprovação pendente",
    description: "Notificação na área do cliente e e-mail sempre que um material for enviado para aprovação.",
    rule: {
      name: "Avisar o cliente sobre aprovação pendente",
      trigger: "approval.requested",
      conditions: [{ field: "stage", op: "eq", value: "client" }],
      actions: [
        {
          type: "notify_client",
          title: "Novo material para aprovar: {{fileName}}",
          body: "Acesse a área do cliente para aprovar ou pedir ajustes.",
          email: true,
        },
      ],
      enabled: true,
    },
  },
  {
    key: "urgent-request",
    title: "Avisar o atendimento quando chegar solicitação urgente",
    description: "Notifica o papel Atendimento e os gestores quando um cliente envia uma solicitação urgente.",
    rule: {
      name: "Solicitação urgente recebida",
      trigger: "request.created",
      conditions: [{ field: "priority", op: "eq", value: "urgent" }],
      actions: [
        {
          type: "notify_members",
          roleKeys: ["account", "manager"],
          title: "Solicitação urgente #{{number}}: {{title}}",
        },
      ],
      enabled: true,
    },
  },
  {
    key: "changes-requested",
    title: "Voltar a tarefa para Ajustes quando o cliente pedir alterações",
    description: "Move a tarefa ligada ao material para o status Ajustes e avisa o responsável.",
    rule: {
      name: "Ajustes pedidos pelo cliente",
      trigger: "approval.decided",
      conditions: [
        { field: "stage", op: "eq", value: "client" },
        { field: "decision", op: "eq", value: "changes_requested" },
      ],
      actions: [
        { type: "set_task_status", statusKey: "adjustments" },
        { type: "notify_members", toAssignee: true, title: "Cliente pediu ajustes em {{fileName}}" },
      ],
      enabled: true,
    },
  },
  {
    key: "project-done-checklist",
    title: "Criar tarefa de encerramento quando o projeto for concluído",
    description: "Cria uma tarefa para revisar entregáveis, arquivar materiais finais e faturar.",
    rule: {
      name: "Encerramento de projeto",
      trigger: "project.status_changed",
      conditions: [{ field: "toCategory", op: "eq", value: "done" }],
      actions: [
        {
          type: "create_task",
          title: "Encerramento: {{name}}",
          description: "Conferir entregáveis finais, marcar arquivos finais e emitir a fatura do projeto.",
          dueInDays: 3,
        },
      ],
      enabled: true,
    },
  },
];
