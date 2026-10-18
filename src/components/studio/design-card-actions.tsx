"use client";

import { Archive, ArchiveRestore, Copy, Eye, LayoutTemplate, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DeleteDialog } from "@/components/app/delete-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { archiveDesignAction, duplicateDesignAction, unarchiveDesignAction } from "@/server/actions/designs";
import { restoreFromTrashAction, trashDesignAction } from "@/server/actions/trash";

export function DesignCardActions({
  id,
  name,
  canManageTemplates,
  isTemplate,
  canDelete = false,
  archived = false,
}: {
  id: string;
  name: string;
  canManageTemplates: boolean;
  isTemplate: boolean;
  canDelete?: boolean;
  archived?: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [deleting, setDeleting] = useState(false);
  const duplicate = useOrgAction(duplicateDesignAction, {
    success: "Cópia criada",
    onSuccess: (d) => router.push(`/w/${orgSlug}/studio/${d.id}`),
  });
  const archive = useOrgAction(archiveDesignAction, { success: "Arte arquivada" });
  const unarchive = useOrgAction(unarchiveDesignAction, { success: "Arte de volta ao Estúdio" });
  const canManage = !isTemplate || canManageTemplates;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon-xs" aria-label={`Ações de ${name}`} className="shadow-sm">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {archived ? (
            canManage ? (
              <DropdownMenuItem onSelect={() => unarchive.run({ id })}>
                <ArchiveRestore /> Desarquivar
              </DropdownMenuItem>
            ) : null
          ) : (
            <>
              {!isTemplate ? (
                <DropdownMenuItem asChild>
                  <Link href={`/w/${orgSlug}/studio/${id}/preview`}>
                    <Eye /> Visualizar publicação
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => duplicate.run({ id })}>
                <Copy /> Duplicar
              </DropdownMenuItem>
              {canManageTemplates && !isTemplate ? (
                <DropdownMenuItem onSelect={() => duplicate.run({ id, asTemplate: true })}>
                  <LayoutTemplate /> Criar template a partir desta arte
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <ConfirmDialog
                  title={`Arquivar "${name}"?`}
                  description="A arte sai da lista principal e fica em Arquivadas, de onde pode voltar a qualquer momento. Arquivos já exportados continuam na central de arquivos."
                  confirmLabel="Arquivar"
                  tone="primary"
                  onConfirm={() => archive.run({ id })}
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Archive /> Arquivar
                    </DropdownMenuItem>
                  }
                />
              ) : null}
            </>
          )}
          {canDelete && canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={() => setDeleting(true)}>
                <Trash2 /> Excluir
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && canManage ? (
        <DeleteDialog
          open={deleting}
          onOpenChange={setDeleting}
          kindLabel={isTemplate ? "template" : "arte"}
          name={name}
          description={`${isTemplate ? "O template" : "A arte"} vai para a Lixeira e pode ser restaurad${isTemplate ? "o" : "a"} por 30 dias. Arquivos já exportados continuam na central de arquivos.`}
          onDelete={(org) => trashDesignAction(org, { id })}
          onUndo={(org) => restoreFromTrashAction(org, { kind: "design", id })}
          successMessage={`${isTemplate ? "Template" : "Arte"} “${name}” movid${isTemplate ? "o" : "a"} para a lixeira`}
        />
      ) : null}
    </>
  );
}
