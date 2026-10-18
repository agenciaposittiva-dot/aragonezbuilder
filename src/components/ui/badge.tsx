import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-2 text-fg-muted",
        accent: "border-transparent bg-accent-soft text-accent-soft-fg",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        danger: "border-transparent bg-danger-soft text-danger",
        info: "border-transparent bg-info-soft text-info",
        outline: "border-border bg-transparent text-fg-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Cores dos status configuráveis (nomes guardados no banco). */
export const STATUS_COLORS: Record<string, { dot: string; badge: string }> = {
  slate: { dot: "bg-slate-400", badge: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300" },
  zinc: { dot: "bg-zinc-400", badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400" },
  blue: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  sky: { dot: "bg-sky-500", badge: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  amber: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  orange: { dot: "bg-orange-500", badge: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" },
  violet: { dot: "bg-violet-500", badge: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  pink: { dot: "bg-pink-500", badge: "bg-pink-50 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300" },
  green: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  teal: { dot: "bg-teal-500", badge: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300" },
  red: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
};

export const STATUS_COLOR_NAMES = Object.keys(STATUS_COLORS);

export function StatusBadge({ name, color, className }: { name: string; color: string; className?: string }) {
  const c = STATUS_COLORS[color] ?? STATUS_COLORS.slate!;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        c.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", c.dot)} aria-hidden="true" />
      {name}
    </span>
  );
}

export function StatusDot({ color, className }: { color: string; className?: string }) {
  const c = STATUS_COLORS[color] ?? STATUS_COLORS.slate!;
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", c.dot, className)} aria-hidden="true" />;
}
