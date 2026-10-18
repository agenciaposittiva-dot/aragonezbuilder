"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-border !bg-surface !text-fg !shadow-lg !font-sans",
          description: "!text-fg-muted",
          actionButton: "!bg-primary !text-primary-fg",
          closeButton: "!bg-surface !border-border !text-fg-muted",
        },
      }}
    />
  );
}

export { toast } from "sonner";
