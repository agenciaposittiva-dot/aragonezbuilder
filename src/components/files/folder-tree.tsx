"use client";

import { Folder, FolderOpen, FolderPlus, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import { cn } from "@/lib/utils";
import { deleteFolderAction, saveFolderAction } from "@/server/actions/files";

export type FolderNode = { id: string; name: string; parentId: string | null; files: number };

type Editing = { mode: "create"; parentId: string | null } | { mode: "rename"; id: string; name: string } | null;

/** Árvore de pastas; a pasta ativa fica na URL (?folderId=). */
export function FolderTree({
  folders,
  canWrite,
  scope,
}: {
  folders: FolderNode[];
  canWrite: boolean;
  scope: { clientId?: string | null; projectId?: string | null };
}) {
  const { params, set } = useSearchParamsState();
  const active = params.get("folderId");
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState("");
  const save = useOrgAction(saveFolderAction, { success: "Pasta salva", onSuccess: () => setEditing(null) });
  const remove = useOrgAction(deleteFolderAction, {
    success: "Pasta excluída",
    onSuccess: () => active && set({ folderId: null }),
  });

  const children = (parentId: string | null) => folders.filter((f) => f.parentId === parentId);
  return (
    <nav aria-label="Pastas" className="grid gap-1">
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-xs font-medium text-fg-subtle uppercase">Pastas</span>
        {canWrite ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Nova pasta"
            onClick={() => {
              setName("");
              setEditing({ mode: "create", parentId: null });
            }}
          >
            <FolderPlus />
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => set({ folderId: null })}
        className={cn(
          "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-surface-2",
          !active && "bg-surface-2 font-medium",
        )}
      >
        <Layers className="size-4 text-fg-subtle" /> Todos os arquivos
      </button>
      <button
        type="button"
        onClick={() => set({ folderId: "root" })}
        className={cn(
          "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-surface-2",
          active === "root" && "bg-surface-2 font-medium",
        )}
      >
        <Folder className="size-4 text-fg-subtle" /> Sem pasta
      </button>
      <ul>
        {children(null).map((n) => (
          <FolderItem
            key={n.id}
            node={n}
            depth={0}
            folders={folders}
            active={active}
            canWrite={canWrite}
            onSelect={(id) => set({ folderId: active === id ? null : id })}
            onCreateSub={(parentId) => {
              setName("");
              setEditing({ mode: "create", parentId });
            }}
            onRename={(node) => {
              setName(node.name);
              setEditing({ mode: "rename", id: node.id, name: node.name });
            }}
            onDelete={(id) => remove.run({ folderId: id })}
          />
        ))}
      </ul>
      {!folders.length && canWrite ? (
        <p className="px-1.5 pt-1 text-xs text-fg-subtle">Crie pastas para organizar por campanha, mês ou tipo.</p>
      ) : null}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editing || !name.trim()) return;
              if (editing.mode === "rename") save.run({ id: editing.id, name });
              else
                save.run({
                  name,
                  parentId: editing.parentId,
                  clientId: scope.clientId ?? null,
                  projectId: scope.projectId ?? null,
                });
            }}
          >
            <DialogHeader>
              <DialogTitle>{editing?.mode === "rename" ? "Renomear pasta" : "Nova pasta"}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Field label="Nome" htmlFor="folder-name" error={save.fieldErrors.name}>
                <Input
                  id="folder-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                  maxLength={80}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={save.pending} disabled={!name.trim()}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

type ItemProps = {
  node: FolderNode;
  depth: number;
  folders: FolderNode[];
  active: string | null;
  canWrite: boolean;
  onSelect: (id: string) => void;
  onCreateSub: (parentId: string) => void;
  onRename: (node: FolderNode) => void;
  onDelete: (id: string) => void;
};

function FolderItem(props: ItemProps) {
  const { node, depth, folders, active, canWrite, onSelect, onCreateSub, onRename, onDelete } = props;
  const isActive = active === node.id;
  const kids = folders.filter((f) => f.parentId === node.id);
  return (
    <li>
      <div
        className={cn(
          "group flex items-center rounded-md pr-1 text-sm hover:bg-surface-2",
          isActive && "bg-surface-2 font-medium text-fg",
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          aria-current={isActive ? "true" : undefined}
        >
          {isActive ? (
            <FolderOpen className="size-4 shrink-0 text-accent-text" />
          ) : (
            <Folder className="size-4 shrink-0 text-fg-subtle" />
          )}
          <span className="truncate">{node.name}</span>
          <span className="tabular ml-auto text-[11px] text-fg-subtle">{node.files || ""}</span>
        </button>
        {canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="ml-1 rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Ações da pasta ${node.name}`}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onCreateSub(node.id)}>
                <FolderPlus /> Nova subpasta
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRename(node)}>
                <Pencil /> Renomear
              </DropdownMenuItem>
              <DropdownMenuItem variant="danger" onSelect={() => onDelete(node.id)}>
                <Trash2 /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {kids.length ? (
        <ul>
          {kids.map((k) => (
            <FolderItem key={k.id} {...props} node={k} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
