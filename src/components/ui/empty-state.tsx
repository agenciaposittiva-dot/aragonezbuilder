import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16",
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-muted">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="grid gap-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? <p className="max-w-sm text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
