import { ArrowDown, ArrowUp, ChevronsUp, Minus } from "lucide-react";
import { PRIORITY_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

const META = {
  low: { icon: ArrowDown, cls: "text-fg-subtle" },
  medium: { icon: Minus, cls: "text-fg-muted" },
  high: { icon: ArrowUp, cls: "text-warning" },
  urgent: { icon: ChevronsUp, cls: "text-danger" },
} as const;

export function PriorityIcon({ priority, className }: { priority: keyof typeof META; className?: string }) {
  const m = META[priority];
  return (
    <m.icon
      className={cn("size-3.5 shrink-0", m.cls, className)}
      aria-label={`Prioridade ${PRIORITY_LABEL[priority]}`}
    />
  );
}

export function PriorityLabel({ priority }: { priority: keyof typeof META }) {
  const m = META[priority];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", m.cls)}>
      <m.icon className="size-3.5" aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export const PRIORITY_OPTIONS = (["urgent", "high", "medium", "low"] as const).map((p) => ({
  value: p,
  label: PRIORITY_LABEL[p]!,
}));
