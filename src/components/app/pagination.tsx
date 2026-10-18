import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  pageSize,
  total,
  searchParams,
  basePath,
}: {
  page: number;
  pageSize: number;
  total: number;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    return total ? (
      <p className="px-5 py-3 text-xs text-fg-subtle">
        {total} {total === 1 ? "registro" : "registros"}
      </p>
    ) : null;
  }
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "page") qs.set(k, v);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls =
    "inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-fg-muted hover:bg-surface-2";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-fg-subtle">
      <span className="tabular">
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkCls} aria-label="Página anterior">
            <ChevronLeft className="size-4" />
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-40")}>
            <ChevronLeft className="size-4" />
          </span>
        )}
        <span className="tabular px-1">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className={linkCls} aria-label="Próxima página">
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-40")}>
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </div>
  );
}
