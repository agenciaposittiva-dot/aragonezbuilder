"use client";

import { Archive, ArchiveRestore, Copy, CopyPlus, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { archiveTaskAction, deleteTaskAction, duplicateTaskAction } from "@/server/actions/tasks";
import { restoreFromTrashAction } from "@/server/actions/trash";

export function TaskActions({
  taskId,
  title,
  archived,
  projectId,
  canWrite,
  canDelete,
  isSubtask = false,
  hasSubtasks = false,
}: {
  taskId: string;
  title: string;
  archived: boolean;
  projectId: string;
  canWrite: boolean;
  canDelete: boolean;
  isSubtask?: boolean;
  hasSubtasks?: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [deleting, setDeleting] = useState(false);
  const archive = useOrgAction(archiveTaskAction, { success: archived ? "Tarefa restaurada" : "Tarefa arquivada" });
  const duplicate = useOrgAction(duplicateTaskAction, {
    success: "Cópia criada",
    onSuccess: (d) => router.push(`/w/${orgSlug}/tasks/${d.id}`),
  });
  if (!canWrite && !canDelete) return null;
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
            <>
              <DropdownMenuItem onSelect={() => duplicate.run({ id: taskId })}>
                <Copy /> Duplicar
              </DropdownMenuItem>
              {!isSubtask && hasSubtasks ? (
                <DropdownMenuItem onSelect={() => duplicate.run({ id: taskId, withSubtasks: true })}>
                  <CopyPlus /> Duplicar com subtarefas
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => archive.run({ id: taskId, archived: !archived })}>
                {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Desarquivar tarefa" : "Arquivar tarefa"}
              </DropdownMenuItem>
            </>
          ) : null}
          {canDelete ? (
            <>
              {canWrite ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem variant="danger" onSelect={() => setDeleting(true)}>
                <Trash2 /> Excluir tarefa
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete ? (
        <DeleteDialog
          open={deleting}
          onOpenChange={setDeleting}
          kindLabel={isSubtask ? "subtarefa" : "tarefa"}
          name={title}
          description={`${isSubtask ? "A subtarefa" : "A tarefa"} vai para a Lixeira${hasSubtasks ? " com as subtarefas" : ""} e pode ser restaurada por 30 dias. Arquivos, aprovações e artes vinculados são preservados.`}
          onDelete={(org) => deleteTaskAction(org, { id: taskId })}
          onUndo={(org) => restoreFromTrashAction(org, { kind: "task", id: taskId })}
          successMessage={`Tarefa “${title}” movida para a lixeira`}
          onDeleted={() => router.replace(`/w/${orgSlug}/projects/${projectId}/tasks`)}
        />
      ) : null}
    </>
  );
}
