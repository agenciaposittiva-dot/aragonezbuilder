"use client";

import { ChevronDown, FolderTree } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * No celular, seções e pastas ficam recolhidas atrás de um botão para os
 * arquivos aparecerem logo; em telas largas a coluna lateral fica sempre aberta.
 */
export function MobileCollapse({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium lg:hidden"
      >
        <span className="flex items-center gap-2">
          <FolderTree className="size-4 text-fg-subtle" /> {label}
        </span>
        <ChevronDown className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      <div className={cn("content-start gap-3", open ? "grid" : "hidden", "lg:grid")}>{children}</div>
    </>
  );
}
