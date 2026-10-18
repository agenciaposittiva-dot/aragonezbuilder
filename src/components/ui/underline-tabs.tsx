"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Abas sublinhadas para seções de uma página de detalhe. */
export function UnderlineTabs({
  items,
  className,
}: {
  items: { label: string; href: string; exact?: boolean; count?: number }[];
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <nav className={cn("-mb-px flex scrollbar-thin gap-5 overflow-x-auto", className)} aria-label="Seções">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 border-transparent pb-2.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg",
              active && "border-fg text-fg",
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="tabular rounded-full bg-surface-3 px-1.5 text-[11px] text-fg-muted">{item.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
