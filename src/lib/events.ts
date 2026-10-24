/*
 * Catálogo de eventos de domínio.
 *
 * Os serviços gravam eventos (via recordActivity) na mesma transação da
 * operação; o worker os consome para gerar notificações, e-mails, automações
 * e processamento assíncrono. Os nomes e campos abaixo são o contrato entre
 * os módulos: mantenha-os estáveis.
 */

export type EventField = {
  key: string;
  label: string;
  type: "text" | "uuid" | "enum" | "number" | "date" | "boolean";
  options?: { value: string; label: string }[];
};

const PRIORITY = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Normal" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];
const CATEGORY = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "A fazer" },
  { value: "in_progress", label: "Em andamento" },
  { value: "review", label: "Revisão" },
  { value: "done", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];
const BILLING = [
  { value: "monthly", label: "Mensal" },
  { value: "one_time", label: "Pontual" },
  { value: "hourly", label: "Por hora" },
];
const STAGE = [
  { value: "internal", label: "Revisão interna" },
  { value: "client", label: "Aprovação do cliente" },
];

export const EVENT_CATALOG = {
  "client.created": { label: "Cliente cadastrado", fields: [{ key: "clientId", label: "Cliente", type: "uuid" }] },
  "client.service_changed": { label: "Serviço contratado alterado", fields: [] },
  "project.created": {
    label: "Projeto criado",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "ownerMembershipId", label: "Responsável", type: "uuid" },
    ],
  },
  "project.updated": { label: "Projeto atualizado", fields: [] },
  "project.status_changed": {
    label: "Status do projeto alterado",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "toCategory", label: "Categoria do novo status", type: "enum", options: CATEGORY },
      { key: "toStatus", label: "Chave do novo status", type: "text" },
    ],
  },
  "project.stage_changed": {
    label: "Etapa do projeto alterada",
    fields: [
      {
        key: "status",
        label: "Situação da etapa",
        type: "enum",
        options: [
          { value: "active", label: "Em andamento" },
          { value: "done", label: "Concluída" },
        ],
      },
    ],
  },
  "task.created": {
    label: "Tarefa criada",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "priority", label: "Prioridade", type: "enum", options: PRIORITY },
      { key: "assigneeMembershipId", label: "Responsável", type: "uuid" },
    ],
  },
  "task.assigned": {
    label: "Tarefa atribuída",
    fields: [
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "assigneeMembershipId", label: "Responsável", type: "uuid" },
    ],
  },
  "task.status_changed": {
    label: "Status da tarefa alterado",
    fields: [
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "toCategory", label: "Categoria do novo status", type: "enum", options: CATEGORY },
      { key: "toStatus", label: "Chave do novo status", type: "text" },
    ],
  },
  "task.completed": { label: "Tarefa concluída", fields: [{ key: "projectId", label: "Projeto", type: "uuid" }] },
  "task.due_changed": {
    label: "Prazo da tarefa alterado",
    fields: [
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "assigneeMembershipId", label: "Responsável", type: "uuid" },
      { key: "toDueDate", label: "Novo prazo", type: "date" },
    ],
  },
  "task.due_soon": {
    label: "Prazo da tarefa próximo (verificação diária)",
    fields: [
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "assigneeMembershipId", label: "Responsável", type: "uuid" },
      { key: "daysLeft", label: "Dias até o prazo (0 = hoje)", type: "number" },
      { key: "priority", label: "Prioridade", type: "enum", options: PRIORITY },
    ],
  },
  "task.unblocked": {
    label: "Tarefa liberada (dependências concluídas)",
    fields: [
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "assigneeMembershipId", label: "Responsável", type: "uuid" },
      { key: "statusCategory", label: "Categoria do status atual", type: "enum", options: CATEGORY },
    ],
  },
  "task.overdue": {
    label: "Tarefa atrasada (verificação diária)",
    fields: [
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "assigneeMembershipId", label: "Responsável", type: "uuid" },
    ],
  },
  "comment.created": {
    label: "Comentário publicado",
    fields: [
      { key: "internal", label: "Interno", type: "boolean" },
      {
        key: "authorKind",
        label: "Autor",
        type: "enum",
        options: [
          { value: "internal", label: "Equipe" },
          { value: "client", label: "Cliente" },
        ],
      },
    ],
  },
  "request.created": {
    label: "Solicitação recebida",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "category", label: "Categoria", type: "text" },
      { key: "priority", label: "Prioridade", type: "enum", options: PRIORITY },
      {
        key: "createdByKind",
        label: "Criada por",
        type: "enum",
        options: [
          { value: "internal", label: "Equipe" },
          { value: "client", label: "Cliente" },
        ],
      },
    ],
  },
  "request.status_changed": {
    label: "Status da solicitação alterado",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "toStatus", label: "Novo status", type: "text" },
    ],
  },
  "request.converted": {
    label: "Solicitação convertida em projeto",
    fields: [{ key: "clientId", label: "Cliente", type: "uuid" }],
  },
  "request.assigned": {
    label: "Solicitação atribuída",
    fields: [{ key: "assigneeMembershipId", label: "Responsável", type: "uuid" }],
  },
  "file.uploaded": {
    label: "Arquivo enviado",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "projectId", label: "Projeto", type: "uuid" },
    ],
  },
  "file.version_uploaded": {
    label: "Nova versão de arquivo",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "versionNumber", label: "Número da versão", type: "number" },
    ],
  },
  "file.shared": {
    label: "Arquivo compartilhado com o cliente",
    fields: [{ key: "clientId", label: "Cliente", type: "uuid" }],
  },
  "file.status_changed": {
    label: "Status do arquivo alterado",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "projectId", label: "Projeto", type: "uuid" },
      { key: "toStatus", label: "Novo status", type: "text" },
    ],
  },
  "approval.requested": {
    label: "Aprovação solicitada",
    fields: [
      { key: "stage", label: "Etapa", type: "enum", options: STAGE },
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "projectId", label: "Projeto", type: "uuid" },
    ],
  },
  "approval.decided": {
    label: "Aprovação decidida",
    fields: [
      { key: "stage", label: "Etapa", type: "enum", options: STAGE },
      {
        key: "decision",
        label: "Decisão",
        type: "enum",
        options: [
          { value: "approved", label: "Aprovado" },
          { value: "changes_requested", label: "Ajustes solicitados" },
        ],
      },
      { key: "clientId", label: "Cliente", type: "uuid" },
    ],
  },
  "approval.reminder": {
    label: "Aprovação pendente há mais de 2 dias",
    fields: [
      { key: "stage", label: "Etapa", type: "enum", options: STAGE },
      { key: "clientId", label: "Cliente", type: "uuid" },
    ],
  },
  "invoice.created": { label: "Fatura criada", fields: [{ key: "clientId", label: "Cliente", type: "uuid" }] },
  "invoice.paid": { label: "Fatura paga", fields: [{ key: "clientId", label: "Cliente", type: "uuid" }] },
  "invoice.overdue": { label: "Fatura vencida", fields: [{ key: "clientId", label: "Cliente", type: "uuid" }] },
  "contract.expiring": {
    label: "Contrato a vencer (verificação diária)",
    fields: [
      { key: "clientId", label: "Cliente", type: "uuid" },
      { key: "daysLeft", label: "Dias até o término (0 = hoje)", type: "number" },
      { key: "billingType", label: "Cobrança", type: "enum", options: BILLING },
    ],
  },
  "design.exported": {
    label: "Arte exportada do editor",
    fields: [{ key: "clientId", label: "Cliente", type: "uuid" }],
  },
  "member.invited": { label: "Convite enviado", fields: [] },
  "member.joined": { label: "Novo membro entrou", fields: [] },
} as const satisfies Record<string, { label: string; fields: readonly EventField[] }>;

export type EventType = keyof typeof EVENT_CATALOG;

/*
 * Campos de payload esperados por evento (referência para quem emite):
 *
 * task.created          { taskId, projectId, clientId, title, assigneeMembershipId, priority, dueDate }
 * task.assigned         { taskId, projectId, title, assigneeMembershipId, previousAssigneeMembershipId }
 * task.status_changed   { taskId, projectId, title, fromStatus, toStatus, toCategory, assigneeMembershipId }
 * task.completed        { taskId, projectId, title, assigneeMembershipId }
 * task.overdue          { taskId, projectId, title, assigneeMembershipId, dueDate }
 * task.due_changed      { taskId, projectId, title, fromDueDate, toDueDate, assigneeMembershipId }
 * task.due_soon         { taskId, projectId, clientId, title, assigneeMembershipId, priority, dueDate, daysLeft }
 * task.unblocked        { taskId, projectId, title, assigneeMembershipId, statusCategory, releasedByTaskId, releasedByTitle }
 * comment.created       { commentId, target: { type, id }, internal, authorKind, authorName, excerpt, mentionedMembershipIds }
 * request.created       { requestId, clientId, number, title, category, priority, createdByKind }
 * request.status_changed{ requestId, clientId, number, title, fromStatus, toStatus }
 * request.converted     { requestId, clientId, projectId }
 * request.assigned      { requestId, clientId, number, title, assigneeMembershipId }
 * file.uploaded         { fileId, versionId, clientId, projectId, taskId, name }
 * file.version_uploaded { fileId, versionId, versionNumber, clientId, projectId, taskId, name }
 * file.shared           { fileId, clientId, shared }
 * approval.requested    { approvalId, fileId, versionId, stage, clientId, projectId, taskId, fileName, dueDate }
 * approval.decided      { approvalId, fileId, versionId, stage, decision, clientId, projectId, taskId, fileName, requestedByUserId }
 * invoice.*             { invoiceId, clientId, number, amountCents, dueDate }
 * contract.expiring     { serviceId, clientId, clientName, name, billingType, amountCents, endsOn, daysLeft }
 * design.exported       { designId, fileId, versionId, clientId, projectId, taskId }
 * member.invited        { invitationId, email, roleKey }
 * member.joined         { membershipId, userId, roleKey }
 */
