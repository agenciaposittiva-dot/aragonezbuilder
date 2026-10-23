"use client";

import { Menu, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatDockButton } from "@/components/chat/chat-dock";
import { GuideButton } from "./guide-panel";
import type { NavKey } from "./nav-registry";
import { NotificationsBell } from "./notifications-bell";
import type { ClientTreeData } from "./client-tree";
import { OrgSwitcher, SidebarBrand, SidebarNav, type OrgOption } from "./sidebar";
import { UserMenu } from "./user-menu";

export function AppHeader({
  nav,
  base,
  badges,
  orgs,
  unread,
  accountHref,
  clientTree,
}: {
  nav: NavKey;
  base: string;
  badges: Record<string, number>;
  orgs: OrgOption[];
  unread: number;
  accountHref: string;
  clientTree?: ClientTreeData | null;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- só disponível no navegador
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menu"
      >
        <Menu />
      </Button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("open-command-menu"))}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-fg-subtle shadow-xs transition-colors hover:border-border-strong"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Buscar…</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        <GuideButton base={base} />
        <ChatDockButton />
        <NotificationsBell initialUnread={unread} />
        <UserMenu accountHref={accountHref} guide />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          width="sm"
          className="max-w-[300px] border-sidebar-border bg-sidebar text-sidebar-fg"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-14 shrink-0 items-center px-3 pr-12">
            <SidebarBrand />
          </div>
          <div className="px-3 pb-2">
            <OrgSwitcher orgs={orgs} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <SidebarNav
              nav={nav}
              base={base}
              badges={badges}
              onNavigate={() => setMobileOpen(false)}
              clientTree={clientTree}
            />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
