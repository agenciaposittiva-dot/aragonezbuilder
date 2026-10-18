"use client";

import { Check, Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MemberLite = {
  membershipId: string;
  name: string;
  image?: string | null;
  jobTitle?: string | null;
  roleName?: string;
};

/** Seleção múltipla de membros com busca. */
export function MemberPicker({
  members,
  value,
  onChange,
  trigger,
  single,
  placeholder = "Adicionar pessoas",
}: {
  members: MemberLite[];
  value: string[];
  onChange: (ids: string[]) => void;
  trigger?: React.ReactNode;
  single?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => members.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())), [members, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <UserPlus />
            {placeholder}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-fg-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar pessoa…"
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          />
        </div>
        <ul className="max-h-64 scrollbar-thin overflow-y-auto p-1" role="listbox" aria-multiselectable={!single}>
          {single ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange([]);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-surface-2"
              >
                Ninguém
              </button>
            </li>
          ) : null}
          {filtered.map((m) => {
            const selected = value.includes(m.membershipId);
            return (
              <li key={m.membershipId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    if (single) {
                      onChange([m.membershipId]);
                      setOpen(false);
                    } else {
                      onChange(selected ? value.filter((v) => v !== m.membershipId) : [...value, m.membershipId]);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-2",
                    selected && "bg-surface-2",
                  )}
                >
                  <Avatar name={m.name} src={m.image} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.name}</span>
                    {m.jobTitle || m.roleName ? (
                      <span className="block truncate text-[11px] text-fg-subtle">{m.jobTitle ?? m.roleName}</span>
                    ) : null}
                  </span>
                  {selected ? <Check className="size-4 text-accent-text" /> : null}
                </button>
              </li>
            );
          })}
          {!filtered.length ? (
            <li className="px-2 py-4 text-center text-xs text-fg-muted">Ninguém encontrado</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
