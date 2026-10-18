"use client";

import { Check, Minus } from "lucide-react";
import { Checkbox as Primitive, Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-surface shadow-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg",
        className,
      )}
      {...props}
    >
      <Primitive.Indicator>
        {props.checked === "indeterminate" ? <Minus className="size-3" /> : <Check className="size-3" strokeWidth={3} />}
      </Primitive.Indicator>
    </Primitive.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-surface-3 transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[17px]" />
    </SwitchPrimitive.Root>
  );
}
