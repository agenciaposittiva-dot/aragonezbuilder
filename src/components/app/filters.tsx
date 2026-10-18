"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldBase } from "@/components/ui/input";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import { cn } from "@/lib/utils";

export function SearchFilter({
  placeholder = "Buscar…",
  param = "q",
  className,
}: {
  placeholder?: string;
  param?: string;
  className?: string;
}) {
  const { params, set } = useSearchParamsState();
  const urlValue = params.get(param) ?? "";
  const [value, setValue] = useState(urlValue);

  useEffect(() => {
    if (value === urlValue) return;
    const t = setTimeout(() => set({ [param]: value.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [value, urlValue, param, set]);

  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(fieldBase, "h-8 pr-7 pl-8")}
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-fg-subtle hover:text-fg"
          aria-label="Limpar busca"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function SelectFilter({
  param,
  label,
  options,
  className,
}: {
  param: string;
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const { params, set } = useSearchParamsState();
  const value = params.get(param) ?? "";
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(e) => set({ [param]: e.target.value || null })}
        aria-label={label}
        className={cn(
          fieldBase,
          "h-8 appearance-none pr-7 pl-2.5 text-[13px]",
          value ? "border-accent/60 bg-accent-soft/40 text-fg" : "text-fg-muted",
        )}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-fg-subtle"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function DateFilter({ param, label }: { param: string; label: string }) {
  const { params, set } = useSearchParamsState();
  return (
    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
      {label}
      <input
        type="date"
        value={params.get(param) ?? ""}
        onChange={(e) => set({ [param]: e.target.value || null })}
        className={cn(fieldBase, "h-8 w-[9.5rem] px-2 text-[13px]")}
      />
    </label>
  );
}

export function ClearFilters({ keys }: { keys: string[] }) {
  const { params, set } = useSearchParamsState();
  const active = keys.some((k) => params.get(k));
  if (!active) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => set(Object.fromEntries(keys.map((k) => [k, null])))}>
      <X /> Limpar filtros
    </Button>
  );
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
