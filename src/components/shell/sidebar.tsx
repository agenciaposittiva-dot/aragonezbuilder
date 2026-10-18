"use client";

import { ChevronsLeft, ChevronsRight, ChevronsUpDown, Check, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo, LogoMark } from "@/components/brand/logo";
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
import { cn } from "@/lib/utils";
import { navAllowed } from "./nav-config";
import { getNav, type NavKey } from "./nav-registry";
import { useWorkspace } from "./workspace-context";

/** Organização no seletor; `logoUrl` é a logo exibida (enviada ou link externo). */
export type OrgOption = { slug: string; name: string; logoUrl: string | null; kind: string };

function setCollapsedCookie(collapsed: boolean) {
  document.cookie = `sidebar_collapsed=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

export function SidebarNav({
  nav,
  base,
  badges,
  collapsed,
  onNavigate,
}: {
  nav: NavKey;
  base: string;
  badges: Record<string, number>;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const groups = getNav(nav);
  const pathname = usePathname();
  const { permissions } = useWorkspace();
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
              const href = base + item.path;
              const active =
                item.path === "" ? pathname === base : pathname === href || pathname.startsWith(href + "/");
              const badge = item.badgeKey ? badges[item.badgeKey] : 0;
              const link = (
                <Link
                  key={item.key}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg",
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
              return collapsed ? (
                <Tooltip key={item.key} content={item.label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
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
          "flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sidebar-hover",
          collapsed && "justify-center",
        )}
        aria-label="Trocar de organização"
      >
        {ws.orgLogoUrl ? <OrgAvatar name={ws.orgName} src={ws.orgLogoUrl} size="md" /> : <LogoMark />}
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

export function Sidebar({
  nav,
  base,
  badges,
  orgs,
  defaultCollapsed,
}: {
  nav: NavKey;
  base: string;
  badges: Record<string, number>;
  orgs: OrgOption[];
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <aside
      className={cn(
        "sticky top-0 z-[var(--z-sidebar)] hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[60px]" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center px-3", collapsed && "justify-center px-2")}>
        <OrgSwitcher orgs={orgs} collapsed={collapsed} />
      </div>
      <div className={cn("min-h-0 flex-1 scrollbar-thin overflow-y-auto px-3 py-3", collapsed && "px-2")}>
        <SidebarNav nav={nav} base={base} badges={badges} collapsed={collapsed} />
      </div>
      <div
        className={cn(
          "flex items-center border-t border-sidebar-border p-3",
          collapsed ? "justify-center px-2" : "justify-between",
        )}
      >
        {collapsed ? null : <Logo tone="inverse" className="scale-90 opacity-70" />}
        <button
          type="button"
          onClick={() => {
            setCollapsed((c) => {
              setCollapsedCookie(!c);
              return !c;
            });
          }}
          className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu ( [ )" : "Recolher menu ( [ )"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
