"use client";

import { Popover as Primitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export const PopoverClose = Primitive.Close;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-[var(--z-popover)] w-72 rounded-lg border border-border bg-surface p-3 shadow-md outline-none data-[state=open]:animate-scale-in",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
