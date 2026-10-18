"use client";

import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
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
import { archiveTaskAction, deleteTaskAction } from "@/server/actions/tasks";

export function TaskActions({
  taskId,
  title,
  archived,
  projectId,
  canWrite,
  canDelete,
}: {
  taskId: string;
  title: string;
  archived: boolean;
  projectId: string;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const archive = useOrgAction(archiveTaskAction, { success: archived ? "Tarefa restaurada" : "Tarefa arquivada" });
  const remove = useOrgAction(deleteTaskAction, {
    success: "Tarefa excluída",
    onSuccess: () => router.replace(`/w/${orgSlug}/projects/${projectId}/tasks`),
  });
  if (!canWrite && !canDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Mais ações">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canWrite ? (
          <DropdownMenuItem onSelect={() => archive.run({ id: taskId, archived: !archived })}>
            {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restaurar tarefa" : "Arquivar tarefa"}
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <ConfirmDialog
              title={`Excluir "${title}"?`}
              description="A tarefa, as subtarefas, o checklist e os registros de tempo serão excluídos. Arquivos e aprovações vinculados são preservados. Esta ação não pode ser desfeita."
              confirmLabel="Excluir"
              onConfirm={() => remove.run({ id: taskId })}
              trigger={
                <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                  <Trash2 /> Excluir tarefa
                </DropdownMenuItem>
              }
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
