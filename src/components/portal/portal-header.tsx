"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { getNav } from "@/components/shell/nav-registry";
import { UserMenu } from "@/components/shell/user-menu";
import { useWorkspace } from "@/components/shell/workspace-context";
import { cn } from "@/lib/utils";

/** Cabeçalho da área do cliente: identidade da agência + navegação horizontal. */
export function PortalHeader({ unread, badges }: { unread: number; badges: Record<string, number> }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const base = `/portal/${ws.orgSlug}`;
  const items = getNav("portal")
    .flatMap((g) => g.items)
    .filter((i) => !i.permission || ws.permissions.includes(i.permission));
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={base} className="flex min-w-0 items-center gap-2.5">
          {ws.orgLogoUrl ? <Avatar name={ws.orgName} src={ws.orgLogoUrl} square size="md" /> : <LogoMark />}
          <span className="truncate text-sm font-semibold">{ws.orgName}</span>
          <span className="hidden rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted sm:inline">
            Área do cliente
          </span>
        </Link>
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
      </nav>
    </header>
  );
}
