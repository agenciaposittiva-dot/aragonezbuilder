"use client";

import { Archive, ArchiveRestore, MoreHorizontal, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgAction } from "@/hooks/use-action";
import { archiveClientAction } from "@/server/actions/clients";
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
  archived: boolean;
};

export function ClientHeaderActions({
  client,
  members,
  canWrite,
  canArchive,
}: {
  client: ClientData;
  members: { membershipId: string; name: string }[];
  canWrite: boolean;
  canArchive: boolean;
}) {
  const archive = useOrgAction(archiveClientAction, {
    success: client.archived ? "Cliente reativado" : "Cliente arquivado",
  });
  if (!canWrite && !canArchive) return null;
  return (
    <div className="flex items-center gap-2">
      {canWrite ? (
        <ClientFormDialog
          client={{ ...client, leadMembershipId: "" }}
          members={members}
          trigger={
            <Button variant="secondary">
              <Pencil /> Editar
            </Button>
          }
        />
      ) : null}
      {canArchive ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="Mais ações">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {client.archived ? (
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
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} variant="danger">
                    <Archive /> Arquivar cliente
                  </DropdownMenuItem>
                }
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
