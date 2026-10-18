"use client";

import { Archive, ArchiveRestore, MoreHorizontal } from "lucide-react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgAction } from "@/hooks/use-action";
import { archiveProjectAction, changeProjectStatusAction } from "@/server/actions/projects";
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

export function ProjectMoreMenu({ projectId, name, archived }: { projectId: string; name: string; archived: boolean }) {
  const archive = useOrgAction(archiveProjectAction, {
    success: archived ? "Projeto restaurado" : "Projeto arquivado",
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Mais ações">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {archived ? (
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
