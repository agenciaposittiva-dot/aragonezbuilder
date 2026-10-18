"use client";

import { Tabs as Primitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Tabs = Primitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn("inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-xs [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = Primitive.Content;
