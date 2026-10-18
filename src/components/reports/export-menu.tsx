"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/shell/workspace-context";

export function ExportMenu({ types }: { types: { key: string; label: string }[] }) {
  const { orgSlug } = useWorkspace();
  const sp = useSearchParams();
  const href = (type: string) => {
    const q = new URLSearchParams({ org: orgSlug, type });
    for (const k of ["from", "to", "clientId"]) {
      const v = sp.get(k);
      if (v) q.set(k, v);
    }
    return `/api/reports/export?${q.toString()}`;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Download /> Exportar CSV
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Respeita o período e o cliente filtrados</DropdownMenuLabel>
        {types.map((t) => (
          <DropdownMenuItem key={t.key} asChild>
            <a href={href(t.key)} download>
              {t.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
