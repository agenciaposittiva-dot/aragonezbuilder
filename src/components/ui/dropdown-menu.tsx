"use client";

import { Check } from "lucide-react";
import { DropdownMenu as Primitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuSub = Primitive.Sub;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;

const itemBase =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-fg outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle";

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-[var(--z-popover)] min-w-44 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-md data-[state=open]:animate-scale-in",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof Primitive.Item> & { variant?: "danger" }) {
  return (
    <Primitive.Item
      className={cn(itemBase, variant === "danger" && "text-danger [&_svg]:text-danger data-[highlighted]:bg-danger-soft", className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem className={cn(itemBase, "pl-7", className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem className={cn(itemBase, "pl-7", className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn("px-2 py-1.5 text-xs font-medium text-fg-subtle", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, ...props }: React.ComponentProps<typeof Primitive.SubTrigger>) {
  return <Primitive.SubTrigger className={cn(itemBase, "data-[state=open]:bg-surface-2", className)} {...props} />;
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        className={cn(
          "z-[var(--z-popover)] min-w-40 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-md",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
