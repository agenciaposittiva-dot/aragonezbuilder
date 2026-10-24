"use client";

import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DeleteDialog } from "@/components/app/delete-dialog";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgAction } from "@/hooks/use-action";
import { archiveClientAction } from "@/server/actions/clients";
import { clientDeletionImpactAction, restoreFromTrashAction, trashClientAction } from "@/server/actions/trash";
import { ClientFormDialog } from "./client-form-dialog";

type ClientData = {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  address: string | null;
  status: "lead" | "active" | "paused" | "inactive";
  notesInternal: string | null;
  categoryId?: string;
  archived: boolean;
};

export function ClientHeaderActions({
  client,
  members,
  canWrite,
  canArchive,
  canDelete = false,
  categories,
}: {
  client: ClientData;
  members: { membershipId: string; name: string }[];
  categories?: { id: string; name: string }[];
  canWrite: boolean;
  canArchive: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [deleting, setDeleting] = useState(false);
  const archive = useOrgAction(archiveClientAction, {
    success: client.archived ? "Cliente reativado" : "Cliente arquivado",
  });
  if (!canWrite && !canArchive && !canDelete) return null;
  return (
    <div className="flex items-center gap-2">
      {canWrite ? (
        <ClientFormDialog
          client={{ ...client, leadMembershipId: "" }}
          members={members}
          categories={categories}
          trigger={
            <Button variant="secondary">
              <Pencil /> Editar
            </Button>
          }
        />
      ) : null}
      {canArchive || canDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="Mais ações">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!canArchive ? null : client.archived ? (
              <DropdownMenuItem onSelect={() => archive.run({ id: client.id, archived: false })}>
                <ArchiveRestore /> Reativar cliente
              </DropdownMenuItem>
            ) : (
              <ConfirmDialog
                title={`Arquivar ${client.name}?`}
                description="O cliente sai das listas e seletores, mas todo o histórico, projetos e arquivos são preservados. Você pode reativá-lo depois."
                confirmLabel="Arquivar"
                onConfirm={() => archive.run({ id: client.id, archived: true })}
                trigger={
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <Archive /> Arquivar cliente
                  </DropdownMenuItem>
                }
              />
            )}
            {canDelete ? (
              <>
                {canArchive ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant="danger" onSelect={() => setDeleting(true)}>
                  <Trash2 /> Excluir cliente
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canDelete ? (
        <DeleteDialog
          open={deleting}
          onOpenChange={setDeleting}
          kindLabel="cliente"
          name={client.name}
          description="O cliente vai para a Lixeira com tudo o que é dele e sai das listas, do portal e dos relatórios. Pode ser restaurado por 30 dias; depois disso, é excluído definitivamente."
          loadImpact={(org) => clientDeletionImpactAction(org, { id: client.id })}
          onDelete={(org, o) => trashClientAction(org, { id: client.id, confirmFinance: o.confirmFinance })}
          onUndo={(org) => restoreFromTrashAction(org, { kind: "client", id: client.id })}
          successMessage={`Cliente “${client.name}” movido para a lixeira`}
          onDeleted={() => router.replace(`/w/${orgSlug}/clients`)}
        />
      ) : null}
    </div>
  );
}
