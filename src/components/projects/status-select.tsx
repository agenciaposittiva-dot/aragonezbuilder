"use client";

import { Check, ChevronDown } from "lucide-react";
import { StatusBadge, StatusDot } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type StatusOption = { id: string; name: string; color: string };

/** Seletor de status que só habilita as transições permitidas pelo fluxo. */
export function StatusSelect({
  current,
  statuses,
  allowedIds,
  onChange,
  disabled,
}: {
  current: StatusOption;
  statuses: StatusOption[];
  /** null = fluxo livre */
  allowedIds: string[] | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  if (disabled) return <StatusBadge name={current.name} color={current.color} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        aria-label="Alterar status"
      >
        <StatusBadge name={current.name} color={current.color} className="pr-1.5" />
        <ChevronDown className="-ml-0.5 size-3.5 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Mover para</DropdownMenuLabel>
        {statuses.map((s) => {
          const allowed = s.id === current.id || allowedIds === null || allowedIds.includes(s.id);
          return (
            <DropdownMenuItem key={s.id} disabled={!allowed} onSelect={() => s.id !== current.id && onChange(s.id)}>
              <StatusDot color={s.color} />
              <span className="flex-1">{s.name}</span>
              {s.id === current.id ? <Check /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
