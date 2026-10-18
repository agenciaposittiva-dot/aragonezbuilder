import {
  BarChart3,
  CalendarDays,
  Bot,
  CheckCheck,
  Cloud,
  FolderKanban,
  FolderOpen,
  Home,
  Brush,
  Inbox,
  ListChecks,
  MessagesSquare,
  Palette,
  ScanSearch,
  Settings,
  Trash2,
  TrendingUp,
  Users,
  Users2,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Exige a permissão (ou qualquer uma da lista). */
  permission?: Permission | Permission[];
  badgeKey?: "requests" | "approvals" | "chat";
};

export function navAllowed(item: NavItem, permissions: readonly Permission[]) {
  if (!item.permission) return true;
  const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
  return needed.some((p) => permissions.includes(p));
}

export type NavGroup = { label?: string; items: NavItem[] };

export const WORKSPACE_NAV: NavGroup[] = [
  {
    items: [
      { key: "home", label: "Início", path: "", icon: Home },
      { key: "tasks", label: "Tarefas", path: "/tasks", icon: ListChecks, permission: "tasks.read" },
      {
        key: "requests",
        label: "Solicitações",
        path: "/requests",
        icon: Inbox,
        permission: "requests.read",
        badgeKey: "requests",
      },
      {
        key: "approvals",
        label: "Aprovações",
        path: "/approvals",
        icon: CheckCheck,
        permission: "files.read",
        badgeKey: "approvals",
      },
      {
        key: "chat",
        label: "Chat da Equipe",
        path: "/chat",
        icon: MessagesSquare,
        permission: "chat.use",
        badgeKey: "chat",
      },
    ],
  },
  {
    label: "Operação",
    items: [
      { key: "clients", label: "Clientes", path: "/clients", icon: Users2, permission: "clients.read" },
      { key: "projects", label: "Projetos", path: "/projects", icon: FolderKanban, permission: "projects.read" },
      { key: "files", label: "Minha Nuvem", path: "/files", icon: Cloud, permission: "files.read" },
      { key: "studio", label: "Estúdio", path: "/studio", icon: Palette, permission: "designs.read" },
      { key: "ai", label: "Assistente IA", path: "/ai", icon: Bot, permission: "ai.use" },
      { key: "trends", label: "Radar de Tendências", path: "/trends", icon: TrendingUp, permission: "trends.read" },
      { key: "brand", label: "Radar de Marca", path: "/brand-radar", icon: ScanSearch, permission: "brand.read" },
      { key: "content", label: "Conteúdos", path: "/content", icon: CalendarDays, permission: "content.read" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { key: "reports", label: "Relatórios", path: "/reports", icon: BarChart3, permission: "reports.read" },
      { key: "finance", label: "Financeiro", path: "/finance", icon: Wallet, permission: "finance.read" },
      { key: "automations", label: "Automações", path: "/automations", icon: Workflow, permission: "automations.read" },
      { key: "team", label: "Equipe", path: "/team", icon: Users, permission: "members.read" },
      { key: "settings", label: "Configurações", path: "/settings", icon: Settings, permission: "org.manage" },
      {
        key: "trash",
        label: "Lixeira",
        path: "/trash",
        icon: Trash2,
        permission: ["clients.delete", "projects.delete", "designs.delete", "files.delete", "tasks.delete"],
      },
    ],
  },
];

export const PORTAL_NAV: NavGroup[] = [
  {
    items: [
      { key: "home", label: "Início", path: "", icon: Home },
      {
        key: "approvals",
        label: "Aprovações",
        path: "/approvals",
        icon: CheckCheck,
        permission: "approvals.decide_client",
        badgeKey: "approvals",
      },
      {
        key: "requests",
        label: "Solicitações",
        path: "/requests",
        icon: Inbox,
        permission: ["requests.read", "requests.write"],
      },
      { key: "projects", label: "Projetos", path: "/projects", icon: FolderKanban, permission: "projects.read" },
      { key: "files", label: "Materiais", path: "/files", icon: FolderOpen, permission: "files.read" },
      { key: "brand", label: "Marca", path: "/brand", icon: Brush, permission: "clients.read" },
      { key: "team", label: "Equipe", path: "/equipe", icon: Users2, permission: "portal.invite" },
    ],
  },
];
