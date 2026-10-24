/*
 * Categorias de notificação e canais. Sem preferência gravada, tudo fica
 * ligado. Compartilhado entre servidor (filtro no despachante) e interface.
 */

export const NOTIFICATION_CATEGORIES = {
  tasks: { label: "Tarefas", description: "Atribuições, revisões e atrasos.", internalOnly: true },
  requests: { label: "Solicitações", description: "Novas demandas e mudanças de status.", internalOnly: false },
  approvals: { label: "Aprovações", description: "Pedidos de aprovação, decisões e ajustes.", internalOnly: false },
  comments: {
    label: "Comentários",
    description: "Mensagens em solicitações, projetos e materiais.",
    internalOnly: false,
  },
  projects: { label: "Projetos", description: "Projetos em aprovação ou concluídos.", internalOnly: false },
  files: { label: "Materiais", description: "Novos materiais, versões e arquivos finais.", internalOnly: false },
  invites: { label: "Convites", description: "Convites aceitos por quem você convidou.", internalOnly: false },
  finance: { label: "Financeiro", description: "Faturas vencidas e contratos a vencer.", internalOnly: true },
  automations: { label: "Automações", description: "Avisos enviados por regras de automação.", internalOnly: false },
  chat: {
    label: "Chat da Equipe",
    description: "Mensagens diretas e menções (cada conversa também pode ser silenciada).",
    internalOnly: true,
  },
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;
export type NotificationChannel = "inApp" | "email";

export type NotificationPrefs = Record<NotificationChannel, Partial<Record<NotificationCategory, boolean>>>;

export const NOTIFICATION_CATEGORY_KEYS = Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[];

/** Categoria de um tipo de evento (ou automação). */
export function categoryOf(eventType: string): NotificationCategory | null {
  if (eventType.startsWith("automation.")) return "automations";
  const prefix = eventType.split(".")[0];
  switch (prefix) {
    case "task":
      return "tasks";
    case "request":
      return "requests";
    case "approval":
      return "approvals";
    case "comment":
      return "comments";
    case "project":
      return "projects";
    case "file":
      return "files";
    case "member":
      return "invites";
    case "invoice":
    case "contract":
      return "finance";
    case "chat":
      return "chat";
    default:
      return null;
  }
}

/** Ligado, a menos que a pessoa tenha desligado explicitamente. */
export function prefEnabled(
  prefs: NotificationPrefs | undefined,
  channel: NotificationChannel,
  category: NotificationCategory | null,
) {
  if (!category || !prefs) return true;
  return prefs[channel][category] !== false;
}
