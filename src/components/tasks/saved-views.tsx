"use client";

import { Bookmark, BookmarkPlus, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { deleteSavedViewAction, saveViewAction } from "@/server/actions/task-organization";

/** Filtros salvos por pessoa: aplicar, salvar os filtros atuais e excluir. */
export function SavedViewsMenu({
  basePath,
  views,
}: {
  basePath: string;
  views: { id: string; name: string; query: string }[];
}) {
  const params = useSearchParams();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const save = useOrgAction(saveViewAction, {
    success: "Filtro salvo",
    onSuccess: () => {
      setNaming(false);
      setName("");
    },
  });
  const remove = useOrgAction(deleteSavedViewAction, { success: "Filtro excluído" });
  const current = params.toString();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" aria-label="Filtros salvos">
            <Bookmark /> Filtros salvos{views.length ? ` (${views.length})` : ""}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {views.length ? (
            <>
              <DropdownMenuLabel>Meus filtros</DropdownMenuLabel>
              {views.map((v) => (
                <div key={v.id} className="flex items-center gap-1">
                  <DropdownMenuItem asChild className="min-w-0 flex-1">
                    <Link href={`${basePath}?${v.query}`}>
                      <span className="truncate">{v.name}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    aria-label={`Excluir filtro ${v.name}`}
                    className="shrink-0 px-1.5 text-fg-subtle hover:text-danger"
                    onSelect={(e) => {
                      e.preventDefault();
                      remove.run({ id: v.id });
                    }}
                  >
                    <X className="size-3.5" />
                  </DropdownMenuItem>
                </div>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : (
            <p className="px-2 py-2 text-xs text-fg-muted">
              Salve combinações de filtros que você usa sempre (ex.: “Minhas vencidas”).
            </p>
          )}
          <DropdownMenuItem onSelect={() => setNaming(true)} disabled={!current}>
            <BookmarkPlus /> Salvar filtros atuais…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Salvar filtros</DialogTitle>
            <DialogDescription>Só você vê os seus filtros salvos.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              id="save-view"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) save.run({ name, query: current });
              }}
            >
              <Field label="Nome" htmlFor="view-name" error={save.fieldErrors.name}>
                <Input
                  id="view-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="Ex.: Minhas vencidas"
                />
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNaming(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="save-view" variant="primary" loading={save.pending} disabled={!name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
