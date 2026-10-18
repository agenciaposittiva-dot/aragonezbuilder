"use client";

import { Copy, LayoutTemplate, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { archiveDesignAction, duplicateDesignAction } from "@/server/actions/designs";

export function DesignCardActions({
  id,
  name,
  canManageTemplates,
  isTemplate,
}: {
  id: string;
  name: string;
  canManageTemplates: boolean;
  isTemplate: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const duplicate = useOrgAction(duplicateDesignAction, {
    success: "Cópia criada",
    onSuccess: (d) => router.push(`/w/${orgSlug}/studio/${d.id}`),
  });
  const archive = useOrgAction(archiveDesignAction, { success: "Arte arquivada" });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon-xs" aria-label={`Ações de ${name}`} className="shadow-sm">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => duplicate.run({ id })}>
          <Copy /> Duplicar
        </DropdownMenuItem>
        {canManageTemplates && !isTemplate ? (
          <DropdownMenuItem onSelect={() => duplicate.run({ id, asTemplate: true })}>
            <LayoutTemplate /> Criar template a partir desta arte
          </DropdownMenuItem>
        ) : null}
        {!isTemplate || canManageTemplates ? (
          <ConfirmDialog
            title={`Arquivar "${name}"?`}
            description="A arte sai do Estúdio. Arquivos já exportados continuam na central de arquivos."
            confirmLabel="Arquivar"
            onConfirm={() => archive.run({ id })}
            trigger={
              <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                <Trash2 /> Arquivar
              </DropdownMenuItem>
            }
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
