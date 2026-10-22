import {
  BarChart3,
  CalendarDays,
  CheckCheck,
  ClipboardList,
  FolderKanban,
  FolderOpen,
  Home,
  Brush,
  Inbox,
  LayoutDashboard,
  Library,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Palette,
  ScanSearch,
  Settings,
  Share2,
  Sparkles,
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
  badgeKey?: "requests" | "approvals" | "chat" | "demands";
  /**
   * Parâmetros da URL que identificam o item (ex.: Calendário = Tarefas com
   * ?view=calendar). O item fica ativo só com esses parâmetros; o item do mesmo
   * caminho sem `query` deixa de ficar ativo quando outro item casa.
   */
  query?: Record<string, string>;
  /** Mostra as categorias de clientes abaixo do item (menu da agência). */
  tree?: "clients";
};

export function navAllowed(item: NavItem, permissions: readonly Permission[]) {
  if (!item.permission) return true;
  const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
  return needed.some((p) => permissions.includes(p));
}

export function navHref(base: string, item: NavItem) {
  const qs = item.query ? `?${new URLSearchParams(item.query).toString()}` : "";
  return base + item.path + qs;
}

export type NavGroup = { label?: string; items: NavItem[] };

/*
 * Organização da agência: o dia a dia e as ferramentas de criação primeiro
 * (Minhas demandas, Dashboard, Clientes, Biblioteca, Estúdio, IA, Calendário,
 * Redes sociais), depois a operação e a gestão. Só entram módulos que existem:
 * "Vendas" (funil comercial) ainda não é um módulo — o Financeiro cobre
 * contratos, faturas e rentabilidade.
 */
export const WORKSPACE_NAV: NavGroup[] = [
  {
    items: [
      {
        key: "demands",
        label: "Minhas demandas",
        path: "/demandas",
        icon: ClipboardList,
        permission: "tasks.read",
        badgeKey: "demands",
      },
      { key: "home", label: "Dashboard", path: "", icon: LayoutDashboard },
      { key: "clients", label: "Clientes", path: "/clients", icon: Users2, permission: "clients.read", tree: "clients" },
      { key: "files", label: "Biblioteca", path: "/files", icon: Library, permission: "files.read" },
      { key: "studio", label: "Estúdio de Carrosséis", path: "/studio", icon: Palette, permission: "designs.read" },
      { key: "ai", label: "Criação com IA", path: "/ai", icon: Sparkles, permission: "ai.use" },
      {
        key: "calendar",
        label: "Calendário",
        path: "/tasks",
        query: { view: "calendar" },
        icon: CalendarDays,
        permission: "tasks.read",
      },
      { key: "content", label: "Redes sociais", path: "/content", icon: Share2, permission: "content.read" },
      { key: "finance", label: "Financeiro", path: "/finance", icon: Wallet, permission: "finance.read" },
      { key: "reports", label: "Relatórios", path: "/reports", icon: BarChart3, permission: "reports.read" },
      {
        key: "trash",
        label: "Lixeira",
        path: "/trash",
        icon: Trash2,
        permission: ["clients.delete", "projects.delete", "designs.delete", "files.delete", "tasks.delete"],
      },
    ],
  },
  {
    label: "Operação",
    items: [
      { key: "projects", label: "Projetos", path: "/projects", icon: FolderKanban, permission: "projects.read" },
      { key: "tasks", label: "Tarefas da equipe", path: "/tasks", icon: ListChecks, permission: "tasks.read" },
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
      { key: "trends", label: "Radar de Tendências", path: "/trends", icon: TrendingUp, permission: "trends.read" },
      { key: "brand", label: "Radar de Marca", path: "/brand-radar", icon: ScanSearch, permission: "brand.read" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { key: "automations", label: "Automações", path: "/automations", icon: Workflow, permission: "automations.read" },
      { key: "team", label: "Equipe", path: "/team", icon: Users, permission: "members.read" },
      { key: "settings", label: "Configurações", path: "/settings", icon: Settings, permission: "org.manage" },
      { key: "updates", label: "Atualizações", path: "/updates", icon: Megaphone },
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
