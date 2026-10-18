"use client";

import { Archive, ArchiveRestore, Eye, EyeOff, MoreHorizontal, Trash2 } from "lucide-react";
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
import { projectDeletionImpactAction, restoreFromTrashAction, trashProjectAction } from "@/server/actions/trash";
import {
  archiveProjectAction,
  changeProjectStatusAction,
  setProjectPortalVisibleAction,
} from "@/server/actions/projects";
import { StatusSelect, type StatusOption } from "./status-select";

export function ProjectStatusControl({
  projectId,
  current,
  statuses,
  allowedIds,
  canWrite,
}: {
  projectId: string;
  current: StatusOption;
  statuses: StatusOption[];
  allowedIds: string[] | null;
  canWrite: boolean;
}) {
  const change = useOrgAction(changeProjectStatusAction, { success: "Status atualizado" });
  return (
    <StatusSelect
      current={current}
      statuses={statuses}
      allowedIds={allowedIds}
      disabled={!canWrite || change.pending}
      onChange={(statusId) => change.run({ projectId, statusId })}
    />
  );
}

export function ProjectMoreMenu({
  projectId,
  name,
  archived,
  portalVisible,
  canArchive,
  canWrite,
  canDelete = false,
}: {
  projectId: string;
  name: string;
  archived: boolean;
  portalVisible: boolean;
  canArchive: boolean;
  canWrite: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [deleting, setDeleting] = useState(false);
  const archive = useOrgAction(archiveProjectAction, {
    success: archived ? "Projeto restaurado" : "Projeto arquivado",
  });
  const portal = useOrgAction(setProjectPortalVisibleAction, {
    success: portalVisible ? "Projeto oculto no portal do cliente" : "Projeto visível no portal do cliente",
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label="Mais ações">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canWrite ? (
            <DropdownMenuItem onSelect={() => portal.run({ id: projectId, visible: !portalVisible })}>
              {portalVisible ? <EyeOff /> : <Eye />}
              {portalVisible ? "Ocultar no portal do cliente" : "Mostrar no portal do cliente"}
            </DropdownMenuItem>
          ) : null}
          {!canArchive ? null : archived ? (
            <DropdownMenuItem onSelect={() => archive.run({ id: projectId, archived: false })}>
              <ArchiveRestore /> Restaurar projeto
            </DropdownMenuItem>
          ) : (
            <ConfirmDialog
              title={`Arquivar "${name}"?`}
              description="O projeto sai das listas, mas tarefas, arquivos, aprovações e histórico são preservados."
              confirmLabel="Arquivar"
              onConfirm={() => archive.run({ id: projectId, archived: true })}
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Archive /> Arquivar projeto
                </DropdownMenuItem>
              }
            />
          )}
          {canDelete ? (
            <>
              {canWrite || canArchive ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem variant="danger" onSelect={() => setDeleting(true)}>
                <Trash2 /> Excluir projeto
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete ? (
        <DeleteDialog
          open={deleting}
          onOpenChange={setDeleting}
          kindLabel="projeto"
          name={name}
          description="O projeto e as tarefas dele vão para a Lixeira. Arquivos e artes continuam no cliente. Pode ser restaurado por 30 dias; depois disso, é excluído definitivamente."
          loadImpact={(org) => projectDeletionImpactAction(org, { id: projectId })}
          onDelete={(org) => trashProjectAction(org, { id: projectId })}
          onUndo={(org) => restoreFromTrashAction(org, { kind: "project", id: projectId })}
          successMessage={`Projeto “${name}” movido para a lixeira`}
          onDeleted={() => router.replace(`/w/${orgSlug}/projects`)}
        />
      ) : null}
    </>
  );
}
