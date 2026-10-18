"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** Abas de navegação ligadas à URL (rotas ou ?view=). */
export function SegmentedNav({
  items,
  param,
  className,
}: {
  items: { label: string; href: string; value?: string; icon?: React.ReactNode }[];
  /** Quando definido, a aba ativa é decidida pelo parâmetro de busca. */
  param?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <nav
      className={cn(
        "inline-flex max-w-full scrollbar-thin items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      {items.map((item, i) => {
        const active = param
          ? (search.get(param) ?? items[0]?.value) === item.value
          : pathname === item.href || (i > 0 && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap text-fg-muted transition-colors hover:text-fg [&_svg]:size-3.5",
              active && "bg-surface text-fg shadow-xs",
            )}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
