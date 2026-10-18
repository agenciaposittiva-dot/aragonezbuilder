"use client";

import { Archive, ArchiveRestore, Eye, EyeOff, MoreHorizontal } from "lucide-react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgAction } from "@/hooks/use-action";
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
}: {
  projectId: string;
  name: string;
  archived: boolean;
  portalVisible: boolean;
  canArchive: boolean;
  canWrite: boolean;
}) {
  const archive = useOrgAction(archiveProjectAction, {
    success: archived ? "Projeto restaurado" : "Projeto arquivado",
  });
  const portal = useOrgAction(setProjectPortalVisibleAction, {
    success: portalVisible ? "Projeto oculto no portal do cliente" : "Projeto visível no portal do cliente",
  });
  return (
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
              <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                <Archive /> Arquivar projeto
              </DropdownMenuItem>
            }
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
