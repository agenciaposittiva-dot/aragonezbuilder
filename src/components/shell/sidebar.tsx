"use client";

import { ChevronDown, ChevronsLeft, ChevronsRight, ChevronsUpDown, Check, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { LogoMark } from "@/components/brand/logo";
import { useChatUnread } from "@/components/chat/chat-unread";
import { OrgAvatar } from "@/components/brand/org-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ClientTree, type ClientTreeData } from "./client-tree";
import { navAllowed, navHref, type NavItem } from "./nav-config";
import { getNav, type NavKey } from "./nav-registry";
import { useWorkspace } from "./workspace-context";

/** Organização no seletor; `logoUrl` é a logo exibida (enviada ou link externo). */
export type OrgOption = { slug: string; name: string; logoUrl: string | null; kind: string };

function setCollapsedCookie(collapsed: boolean) {
  document.cookie = `sidebar_collapsed=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

/** Item ativo: caminho e, quando o item tem `query`, os parâmetros da URL. */
function isActive(item: NavItem, all: NavItem[], base: string, pathname: string, params: URLSearchParams) {
  const href = base + item.path;
  const onPath = item.path === "" ? pathname === base : pathname === href || pathname.startsWith(href + "/");
  if (!onPath) return false;
  const matches = (i: NavItem) => !!i.query && Object.entries(i.query).every(([k, v]) => params.get(k) === v);
  if (item.query) return pathname === href && matches(item);
  // Outro item do mesmo caminho com parâmetros (ex.: Calendário dentro de Tarefas) tem prioridade.
  return !all.some((i) => i !== item && i.path === item.path && pathname === href && matches(i));
}

/* Árvore de clientes aberta/fechada: conveniência deste navegador. */
const TREE_KEY = "sidebar:clients-open";
function useTreeOpen(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (fn) => {
      window.addEventListener(TREE_KEY, fn);
      return () => window.removeEventListener(TREE_KEY, fn);
    },
    () => {
      try {
        return window.localStorage.getItem(TREE_KEY) !== "0";
      } catch {
        return true;
      }
    },
    () => true,
  );
  const set = (v: boolean) => {
    try {
      window.localStorage.setItem(TREE_KEY, v ? "1" : "0");
    } catch {
      // Sem armazenamento: vale até recarregar.
    }
    window.dispatchEvent(new Event(TREE_KEY));
  };
  return [value, set];
}

export function SidebarNav({
  nav,
  base,
  badges,
  collapsed,
  onNavigate,
  clientTree,
}: {
  nav: NavKey;
  base: string;
  badges: Record<string, number>;
  collapsed?: boolean;
  onNavigate?: () => void;
  /** Categorias e clientes exibidos abaixo de "Clientes" (menu da agência). */
  clientTree?: ClientTreeData | null;
}) {
  const groups = getNav(nav);
  const pathname = usePathname();
  const params = useSearchParams();
  const { permissions } = useWorkspace();
  const [treeOpen, setTreeOpen] = useTreeOpen();
  // Não lidas do chat: valor ao vivo (sincronização) quando disponível.
  const chatUnread = useChatUnread();
  const all = groups.flatMap((g) => g.items);
  return (
    <nav className="grid gap-5" aria-label="Navegação principal">
      {groups.map((group, gi) => {
        const items = group.items.filter((i) => navAllowed(i, permissions));
        if (!items.length) return null;
        return (
          <div key={gi} className="grid gap-0.5">
            {group.label && !collapsed ? (
              <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-sidebar-muted/80 uppercase">
                {group.label}
              </p>
            ) : null}
            {items.map((item) => {
              const href = navHref(base, item);
              const active = isActive(item, all, base, pathname, params);
              const badge =
                item.badgeKey === "chat" && chatUnread ? chatUnread.count : item.badgeKey ? badges[item.badgeKey] : 0;
              const tree = item.tree === "clients" && clientTree && !collapsed ? clientTree : null;
              const link = (
                <Link
                  key={item.key}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg",
                    active && "bg-sidebar-active text-sidebar-fg",
                    collapsed && "justify-center px-0",
                  )}
                >
                  {active ? (
                    <span
                      className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent"
                      aria-hidden="true"
                    />
                  ) : null}
                  <item.icon className={cn("size-4 shrink-0", active ? "text-accent" : "")} />
                  {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                  {badge && !collapsed ? (
                    <span className="tabular rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-accent-fg">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                  {badge && collapsed ? (
                    <span className="absolute top-1 right-1.5 size-1.5 rounded-full bg-accent" aria-hidden="true" />
                  ) : null}
                </Link>
              );
              if (collapsed) {
                return (
                  <Tooltip key={item.key} content={badge ? `${item.label} (${badge})` : item.label} side="right">
                    {link}
                  </Tooltip>
                );
              }
              if (!tree) return link;
              return (
                <div key={item.key}>
                  <div className="flex items-center gap-0.5">
                    {link}
                    {tree.canManage ? (
                      <Link
                        href={`${base}/clients?novo=1`}
                        onClick={onNavigate}
                        aria-label="Novo cliente"
                        title="Novo cliente"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
                      >
                        <Plus className="size-3.5" />
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setTreeOpen(!treeOpen)}
                      aria-expanded={treeOpen}
                      aria-label={treeOpen ? "Recolher categorias de clientes" : "Mostrar categorias de clientes"}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
                    >
                      <ChevronDown className={cn("size-3.5 transition-transform", !treeOpen && "-rotate-90")} />
                    </button>
                  </div>
                  {treeOpen ? <ClientTree base={base} data={tree} onNavigate={onNavigate} /> : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function OrgSwitcher({ orgs, collapsed }: { orgs: OrgOption[]; collapsed?: boolean }) {
  const ws = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-hover/40 p-1.5 text-left transition-colors hover:bg-sidebar-hover",
          collapsed && "justify-center border-transparent bg-transparent",
        )}
        aria-label="Trocar de organização"
        title={collapsed ? `${ws.orgName} · ${ws.roleName}` : undefined}
      >
        <OrgAvatar name={ws.orgName} src={ws.orgLogoUrl} size="md" />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-sidebar-fg">{ws.orgName}</span>
              <span className="block truncate text-[11px] text-sidebar-muted">{ws.roleName}</span>
            </span>
            <ChevronsUpDown className="size-3.5 text-sidebar-muted" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizações</DropdownMenuLabel>
        {orgs.map((o) => (
          <DropdownMenuItem key={o.slug} asChild>
            <Link href={o.kind === "client" ? `/portal/${o.slug}` : `/w/${o.slug}`}>
              <OrgAvatar name={o.name} src={o.logoUrl} size="xs" />
              <span className="flex-1 truncate">{o.name}</span>
              {o.slug === ws.orgSlug ? <Check /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus />
            Criar agência
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Marca da plataforma no topo do menu (nome e linha de apoio). */
export function SidebarBrand({ collapsed }: { collapsed?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", collapsed && "justify-center")}>
      <LogoMark />
      {collapsed ? null : (
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold tracking-tight text-sidebar-fg">{APP_NAME}</span>
          <span className="block truncate text-[11px] text-sidebar-muted">Criação, conteúdo e gestão</span>
        </span>
      )}
    </span>
  );
}

export function Sidebar({
  nav,
  base,
  badges,
  orgs,
  defaultCollapsed,
  clientTree,
}: {
  nav: NavKey;
  base: string;
  badges: Record<string, number>;
  orgs: OrgOption[];
  defaultCollapsed: boolean;
  clientTree?: ClientTreeData | null;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      setCollapsedCookie(!c);
      return !c;
    });
  return (
    <aside
      className={cn(
        "sticky top-0 z-[var(--z-sidebar)] hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[60px]" : "w-64",
      )}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-3", collapsed && "flex-col justify-center gap-0 px-2")}>
        {collapsed ? null : (
          <Link href={base} className="min-w-0 flex-1 rounded-md" aria-label={`${APP_NAME}: Dashboard`}>
            <SidebarBrand />
          </Link>
        )}
        <Tooltip content={collapsed ? "Expandir menu" : "Recolher menu"} side="right">
          <button
            type="button"
            onClick={toggle}
            className="shrink-0 rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg"
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!collapsed}
            data-testid="sidebar-toggle"
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        </Tooltip>
      </div>
      <div className={cn("px-3 pb-2", collapsed && "px-2")}>
        <OrgSwitcher orgs={orgs} collapsed={collapsed} />
      </div>
      <div className={cn("min-h-0 flex-1 scrollbar-thin overflow-y-auto px-3 py-2", collapsed && "px-2")}>
        <SidebarNav nav={nav} base={base} badges={badges} collapsed={collapsed} clientTree={clientTree} />
      </div>
    </aside>
  );
}
