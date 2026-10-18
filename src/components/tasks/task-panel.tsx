"use client";

import { Maximize2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/** Painel lateral de detalhes: fecha voltando à visão anterior (filtros preservados). */
export function TaskPanel({ pageHref, children }: { pageHref: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(open) => (open ? null : router.back())}>
      <SheetContent width="xl" className="overflow-y-auto">
        <SheetTitle className="sr-only">Detalhes da tarefa</SheetTitle>
        <SheetDescription className="sr-only">Edite a tarefa sem sair da lista.</SheetDescription>
        <div className="flex items-center justify-end gap-1 border-b border-border px-4 py-2 pr-12">
          <a
            href={pageHref}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <Maximize2 className="size-3.5" /> Abrir em página inteira
          </a>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
