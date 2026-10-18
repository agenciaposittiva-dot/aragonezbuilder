"use client";

import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { navAllowed } from "@/components/shell/nav-config";
import { getNav } from "@/components/shell/nav-registry";
import { UserMenu } from "@/components/shell/user-menu";
import { useWorkspace, workspaceBase } from "@/components/shell/workspace-context";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Cabeçalho do portal: identidade do cliente + navegação horizontal. */
export function PortalHeader({
  unread,
  badges,
  brand,
  switchHref,
}: {
  unread: number;
  badges: Record<string, number>;
  brand: { name: string; logoUrl: string | null; orgName: string };
  switchHref: string | null;
}) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const base = workspaceBase(ws);
  const items = getNav("portal")
    .flatMap((g) => g.items)
    .filter((i) => navAllowed(i, ws.permissions));
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={base} className="flex min-w-0 items-center gap-2.5">
          <Avatar
            name={brand.name}
            src={brand.logoUrl}
            square
            size="md"
            className={brand.logoUrl ? "bg-surface ring-1 ring-border [&_img]:object-contain" : undefined}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm leading-tight font-semibold">{brand.name}</span>
            <span className="block truncate text-[11px] leading-tight text-fg-muted">
              Área do cliente · {brand.orgName}
            </span>
          </span>
        </Link>
        {switchHref ? (
          <Link
            href={switchHref}
            className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
          >
            <ArrowLeftRight className="size-3.5" /> Trocar
          </Link>
        ) : null}
        <span className="flex-1" />
        <NotificationsBell initialUnread={unread} />
        <UserMenu accountHref={`${base}/account`} />
      </div>
      <nav
        className="mx-auto flex max-w-6xl scrollbar-thin gap-1 overflow-x-auto px-2 sm:px-4"
        aria-label="Área do cliente"
      >
        {items.map((item) => {
          const href = base + item.path;
          const active = item.path === "" ? pathname === base : pathname.startsWith(href);
          const badge = item.badgeKey ? badges[item.badgeKey] : 0;
          return (
            <Link
              key={item.key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg",
                active && "border-accent text-fg",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
              {badge ? (
                <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-accent-fg">
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
        {switchHref ? (
          <Link
            href={switchHref}
            className="flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-fg-muted hover:text-fg sm:hidden"
          >
            <ArrowLeftRight className="size-4" /> Trocar
          </Link>
        ) : null}
      </nav>
    </header>
  );
}
