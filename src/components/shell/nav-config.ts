import {
  BarChart3,
  Bot,
  CheckCheck,
  FolderKanban,
  FolderOpen,
  Home,
  Brush,
  Inbox,
  ListChecks,
  Palette,
  Settings,
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
  permission?: Permission;
  badgeKey?: "requests" | "approvals";
};

export type NavGroup = { label?: string; items: NavItem[] };

export const WORKSPACE_NAV: NavGroup[] = [
  {
    items: [
      { key: "home", label: "Início", path: "", icon: Home },
      { key: "tasks", label: "Tarefas", path: "/tasks", icon: ListChecks, permission: "tasks.read" },
      { key: "requests", label: "Solicitações", path: "/requests", icon: Inbox, permission: "requests.read", badgeKey: "requests" },
      { key: "approvals", label: "Aprovações", path: "/approvals", icon: CheckCheck, permission: "files.read", badgeKey: "approvals" },
    ],
  },
  {
    label: "Operação",
    items: [
      { key: "clients", label: "Clientes", path: "/clients", icon: Users2, permission: "clients.read" },
      { key: "projects", label: "Projetos", path: "/projects", icon: FolderKanban, permission: "projects.read" },
      { key: "files", label: "Arquivos", path: "/files", icon: FolderOpen, permission: "files.read" },
      { key: "studio", label: "Estúdio", path: "/studio", icon: Palette, permission: "designs.read" },
      { key: "ai", label: "Assistente IA", path: "/ai", icon: Bot, permission: "ai.use" },
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
    ],
  },
];

export const PORTAL_NAV: NavGroup[] = [
  {
    items: [
      { key: "home", label: "Início", path: "", icon: Home },
      { key: "approvals", label: "Aprovações", path: "/approvals", icon: CheckCheck, permission: "approvals.decide_client", badgeKey: "approvals" },
      { key: "requests", label: "Solicitações", path: "/requests", icon: Inbox, permission: "requests.read" },
      { key: "projects", label: "Projetos", path: "/projects", icon: FolderKanban, permission: "projects.read" },
      { key: "files", label: "Materiais", path: "/files", icon: FolderOpen, permission: "files.read" },
      { key: "brand", label: "Marca", path: "/brand", icon: Brush, permission: "clients.read" },
    ],
  },
];
