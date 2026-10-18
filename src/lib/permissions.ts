/*
 * Catálogo de permissões e papéis padrão.
 *
 * Este arquivo é compartilhado entre servidor e interface. A interface usa as
 * permissões apenas para decidir o que exibir; toda operação protegida é
 * verificada novamente no backend (src/server/authz).
 */

export const PERMISSIONS = {
  "org.manage": "Gerenciar configurações da organização",
  "members.read": "Ver equipe",
  "members.manage": "Convidar, editar e remover membros",
  "roles.manage": "Gerenciar papéis e permissões",
  "data.all": "Acessar todos os clientes e projetos (sem essa permissão, só os atribuídos)",
  "clients.read": "Ver clientes",
  "clients.write": "Criar e editar clientes",
  "clients.archive": "Arquivar clientes",
  "projects.read": "Ver projetos",
  "projects.write": "Criar e editar projetos",
  "projects.archive": "Arquivar projetos",
  "tasks.read": "Ver tarefas",
  "tasks.write": "Criar e editar tarefas",
  "tasks.assign": "Atribuir tarefas a outras pessoas",
  "tasks.delete": "Excluir tarefas",
  "time.track": "Registrar tempo",
  "time.read_all": "Ver tempo registrado por toda a equipe",
  "requests.read": "Ver solicitações",
  "requests.write": "Criar e editar solicitações",
  "requests.triage": "Triar e converter solicitações em projetos",
  "briefings.manage": "Gerenciar modelos de briefing",
  "files.read": "Ver arquivos",
  "files.write": "Enviar e editar arquivos",
  "files.delete": "Excluir arquivos",
  "files.share": "Compartilhar arquivos com o cliente",
  "approvals.request": "Enviar materiais para aprovação",
  "approvals.decide_internal": "Aprovar na revisão interna",
  "approvals.decide_client": "Aprovar como cliente",
  "comments.internal": "Ver e escrever comentários internos",
  "ai.use": "Usar o assistente de IA",
  "ai.settings": "Configurar provedores e limites de IA",
  "designs.read": "Ver artes do editor",
  "designs.write": "Criar e editar artes no editor",
  "templates.manage": "Gerenciar templates do editor",
  "reports.read": "Ver relatórios e indicadores",
  "reports.export": "Exportar relatórios",
  "automations.read": "Ver automações",
  "automations.manage": "Criar e editar automações",
  "finance.read": "Ver financeiro",
  "finance.write": "Lançar e editar registros financeiros",
  "costs.read": "Ver custos internos (custo/hora, rentabilidade)",
  "audit.read": "Ver histórico de auditoria",
  "portal.access": "Acessar a área do cliente",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Permissões que nunca podem ser concedidas a um papel de cliente. */
export const INTERNAL_ONLY: Permission[] = [
  "org.manage",
  "members.manage",
  "roles.manage",
  "data.all",
  "clients.write",
  "clients.archive",
  "projects.write",
  "projects.archive",
  "tasks.write",
  "tasks.assign",
  "tasks.delete",
  "time.track",
  "time.read_all",
  "requests.triage",
  "briefings.manage",
  "files.delete",
  "files.share",
  "approvals.request",
  "approvals.decide_internal",
  "comments.internal",
  "ai.settings",
  "designs.write",
  "templates.manage",
  "reports.export",
  "automations.read",
  "automations.manage",
  "finance.write",
  "costs.read",
  "audit.read",
];

export type RoleKind = "internal" | "client";

export type SystemRoleKey =
  | "owner"
  | "admin"
  | "manager"
  | "account"
  | "designer"
  | "copywriter"
  | "social_media"
  | "traffic"
  | "finance"
  | "collaborator"
  | "client";

type RoleDef = {
  key: SystemRoleKey;
  name: string;
  description: string;
  kind: RoleKind;
  permissions: Permission[];
};

const CREATIVE: Permission[] = [
  "data.all",
  "members.read",
  "clients.read",
  "projects.read",
  "tasks.read",
  "tasks.write",
  "time.track",
  "requests.read",
  "files.read",
  "files.write",
  "approvals.request",
  "comments.internal",
  "ai.use",
  "designs.read",
  "designs.write",
  "reports.read",
];

export const SYSTEM_ROLES: RoleDef[] = [
  {
    key: "owner",
    name: "Proprietário",
    description: "Acesso total, inclusive cobrança e exclusão da organização.",
    kind: "internal",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "approvals.decide_client" && p !== "portal.access"),
  },
  {
    key: "admin",
    name: "Administrador",
    description: "Gerencia equipe, papéis, configurações e todos os módulos.",
    kind: "internal",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "approvals.decide_client" && p !== "portal.access"),
  },
  {
    key: "manager",
    name: "Diretor / Gestor",
    description: "Coordena clientes, projetos, equipe e indicadores.",
    kind: "internal",
    permissions: [
      "data.all",
      "members.read",
      "members.manage",
      "clients.read",
      "clients.write",
      "clients.archive",
      "projects.read",
      "projects.write",
      "projects.archive",
      "tasks.read",
      "tasks.write",
      "tasks.assign",
      "tasks.delete",
      "time.track",
      "time.read_all",
      "requests.read",
      "requests.write",
      "requests.triage",
      "briefings.manage",
      "files.read",
      "files.write",
      "files.delete",
      "files.share",
      "approvals.request",
      "approvals.decide_internal",
      "comments.internal",
      "ai.use",
      "designs.read",
      "designs.write",
      "templates.manage",
      "reports.read",
      "reports.export",
      "automations.read",
      "automations.manage",
      "finance.read",
      "costs.read",
      "audit.read",
    ],
  },
  {
    key: "account",
    name: "Atendimento",
    description: "Relacionamento com clientes, solicitações e aprovações.",
    kind: "internal",
    permissions: [
      "data.all",
      "members.read",
      "clients.read",
      "clients.write",
      "projects.read",
      "projects.write",
      "tasks.read",
      "tasks.write",
      "tasks.assign",
      "time.track",
      "requests.read",
      "requests.write",
      "requests.triage",
      "briefings.manage",
      "files.read",
      "files.write",
      "files.share",
      "approvals.request",
      "approvals.decide_internal",
      "comments.internal",
      "ai.use",
      "designs.read",
      "reports.read",
      "automations.read",
    ],
  },
  {
    key: "designer",
    name: "Designer",
    description: "Produção de peças e artes.",
    kind: "internal",
    permissions: CREATIVE,
  },
  {
    key: "copywriter",
    name: "Redator",
    description: "Produção de textos, roteiros e conteúdo.",
    kind: "internal",
    permissions: CREATIVE,
  },
  {
    key: "social_media",
    name: "Social media",
    description: "Planejamento e publicação de conteúdo.",
    kind: "internal",
    permissions: [...CREATIVE, "requests.write"],
  },
  {
    key: "traffic",
    name: "Gestor de tráfego",
    description: "Campanhas e mídia paga.",
    kind: "internal",
    permissions: [...CREATIVE, "requests.write"],
  },
  {
    key: "finance",
    name: "Financeiro",
    description: "Faturas, despesas, contratos e rentabilidade.",
    kind: "internal",
    permissions: [
      "data.all",
      "members.read",
      "clients.read",
      "projects.read",
      "tasks.read",
      "time.read_all",
      "requests.read",
      "files.read",
      "reports.read",
      "reports.export",
      "finance.read",
      "finance.write",
      "costs.read",
    ],
  },
  {
    key: "collaborator",
    name: "Colaborador",
    description: "Acesso apenas aos projetos e tarefas atribuídos.",
    kind: "internal",
    permissions: [
      "clients.read",
      "projects.read",
      "tasks.read",
      "tasks.write",
      "time.track",
      "requests.read",
      "files.read",
      "files.write",
      "approvals.request",
      "comments.internal",
      "designs.read",
      "designs.write",
    ],
  },
  {
    key: "client",
    name: "Cliente",
    description: "Área do cliente: solicitações, aprovações e materiais compartilhados.",
    kind: "client",
    permissions: [
      "portal.access",
      "clients.read",
      "projects.read",
      "requests.read",
      "requests.write",
      "files.read",
      "approvals.decide_client",
    ],
  },
];

export function sanitizePermissions(kind: RoleKind, permissions: string[]): Permission[] {
  const valid = permissions.filter((p): p is Permission => p in PERMISSIONS);
  const unique = [...new Set(valid)];
  return kind === "client" ? unique.filter((p) => !INTERNAL_ONLY.includes(p)) : unique;
}
