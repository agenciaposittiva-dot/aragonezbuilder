"use client";

import { Tooltip as Primitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = Primitive.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
  disabled,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[var(--z-popover)] rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-fg shadow-md data-[state=delayed-open]:animate-fade-in",
          )}
        >
          {content}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
