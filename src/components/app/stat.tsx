import Link from "next/link";
import { cn } from "@/lib/utils";

/** Indicador numérico compacto. */
export function Stat({
  label,
  value,
  hint,
  tone,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "danger" | "warning" | "success";
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-2xl font-semibold tracking-tight text-fg",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p> : null}
    </>
  );
  const cls = cn(
    "rounded-xl border border-border bg-surface px-4 py-3.5 shadow-xs",
    href && "transition-colors hover:border-border-strong",
    className,
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)} {...props}>
      {children}
    </div>
  );
}

export function InfoList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-fg-subtle">{it.label}</dt>
          <dd className="mt-0.5 truncate text-fg">{it.value || <span className="text-fg-subtle">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
