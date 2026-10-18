"use client";

import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Painel lateral para ações contextuais (detalhe de tarefa, filtros...). */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = SheetPrimitive.Title;
export const SheetDescription = SheetPrimitive.Description;

export function SheetContent({
  className,
  children,
  side = "right",
  width = "md",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "right" | "left";
  width?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-overlay data-[state=open]:animate-fade-in" />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-[var(--z-modal)] flex w-full flex-col border-border bg-surface shadow-lg outline-none",
          side === "right"
            ? "right-0 border-l data-[state=open]:animate-slide-in-right"
            : "left-0 border-r data-[state=open]:animate-slide-in-left",
          { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[width],
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className="absolute top-3.5 right-3.5 rounded-sm p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
