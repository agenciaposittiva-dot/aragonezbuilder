"use client";

import { Archive, ArchiveRestore, Copy, Download, FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { deleteFileAction, duplicateFileAction, patchFileAction, setFileArchivedAction } from "@/server/actions/files";
import { DriveExportMenuItem } from "./drive-export-button";

export type FileActionsTarget = {
  id: string;
  name: string;
  versionId: string | null;
  archived: boolean;
  folderId?: string | null;
};

export type FileActionsPermissions = {
  canWrite: boolean;
  canDelete: boolean;
  /** Pastas para onde o arquivo pode ir (mesmo cliente/projeto). */
  folders?: { id: string; name: string }[];
  /** A pessoa tem o Google Drive conectado: oferece "Salvar no Google Drive". */
  driveConnected?: boolean;
};

/**
 * Exclusão de arquivo: vai para a Lixeira (30 dias). Se alguma arte do
 * Estúdio usa o arquivo, o servidor avisa e a exclusão pede uma segunda
 * confirmação explícita.
 */
export function FileDeleteDialog({
  open,
  onOpenChange,
  file,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  file: { id: string; name: string };
  onDeleted?: () => void;
}) {
  const { orgSlug } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [inUse, setInUse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(force: boolean) {
    setBusy(true);
    setError(null);
    const res = await deleteFileAction(orgSlug, { fileId: file.id, force }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onOpenChange(false);
      setInUse(null);
      toast.success(`“${file.name}” foi para a lixeira`, { description: "Fica lá por 30 dias." });
      onDeleted?.();
      return;
    }
    if (res && !res.ok && res.fieldErrors?.inUse) setInUse(res.error);
    else setError(res && !res.ok ? res.error : "Falha de conexão. Nada foi excluído.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        onOpenChange(v);
        if (!v) {
          setInUse(null);
          setError(null);
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Excluir “{file.name}”?</DialogTitle>
          <DialogDescription>
            O arquivo vai para a Lixeira e pode ser restaurado por 30 dias. Aprovações pendentes dele são canceladas.
          </DialogDescription>
        </DialogHeader>
        {inUse || error ? (
          <DialogBody>
            <p role="alert" className={cn("text-sm", inUse ? "text-warning" : "text-danger")}>
              {inUse ?? error}
            </p>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void run(!!inUse)}>
            <Trash2 /> {inUse ? "Excluir mesmo assim" : "Mover para a lixeira"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Menu ⋮ de um arquivo na Minha Nuvem. */
export function FileActionsMenu({
  file,
  permissions,
  className,
}: {
  file: FileActionsTarget;
  permissions: FileActionsPermissions;
  className?: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(file.name);
  const [folderId, setFolderId] = useState(file.folderId ?? "");
  const patch = useOrgAction(patchFileAction, {
    success: "Arquivo atualizado",
    onSuccess: () => {
      setRenaming(false);
      setMoving(false);
    },
  });
  const duplicate = useOrgAction(duplicateFileAction, { success: "Cópia criada" });
  const archive = useOrgAction(setFileArchivedAction, {
    success: file.archived ? "Arquivo desarquivado" : "Arquivo arquivado",
  });
  const { canWrite, canDelete, folders = [], driveConnected = false } = permissions;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon-xs" aria-label={`Ações de ${file.name}`} className={className}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {file.versionId ? (
            <DropdownMenuItem asChild>
              <a href={`/api/files/${file.versionId}?download=1`}>
                <Download /> Baixar
              </a>
            </DropdownMenuItem>
          ) : null}
          {file.versionId && canWrite && driveConnected ? <DriveExportMenuItem versionId={file.versionId} /> : null}
          {canWrite ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setName(file.name);
                  setRenaming(true);
                }}
              >
                <Pencil /> Renomear
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setFolderId(file.folderId ?? "");
                  setMoving(true);
                }}
              >
                <FolderInput /> Mover para pasta
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => duplicate.run({ fileId: file.id })}>
                <Copy /> Duplicar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => archive.run({ fileId: file.id, archived: !file.archived })}>
                {file.archived ? <ArchiveRestore /> : <Archive />} {file.archived ? "Desarquivar" : "Arquivar"}
              </DropdownMenuItem>
            </>
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={() => setDeleting(true)}>
                <Trash2 /> Excluir
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={(v) => !patch.pending && setRenaming(v)}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              patch.run({ id: file.id, name });
            }}
          >
            <DialogHeader>
              <DialogTitle>Renomear arquivo</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Field label="Nome" htmlFor={`rn-${file.id}`} error={patch.fieldErrors.name}>
                <Input id={`rn-${file.id}`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setRenaming(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={patch.pending} disabled={!name.trim()}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={moving} onOpenChange={(v) => !patch.pending && setMoving(v)}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              patch.run({ id: file.id, folderId: folderId || null });
            }}
          >
            <DialogHeader>
              <DialogTitle>Mover “{file.name}”</DialogTitle>
              <DialogDescription>Organizar em pastas não duplica o arquivo.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label="Pasta" htmlFor={`mv-${file.id}`} error={patch.fieldErrors.folderId}>
                <NativeSelect id={`mv-${file.id}`} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">Sem pasta</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setMoving(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={patch.pending}>
                Mover
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <FileDeleteDialog open={deleting} onOpenChange={setDeleting} file={file} />
    </>
  );
}
