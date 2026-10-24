"use client";

import { Cloud, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useOrgAction } from "@/hooks/use-action";
import { exportVersionToDriveAction } from "@/server/actions/google-drive";

/*
 * "Salvar no Google Drive": envia a versão atual de um arquivo da plataforma
 * para o Drive da própria pessoa (pasta padrão + organização escolhida). Só
 * mostra sucesso depois que o Google confirma; o link vem na resposta.
 */

type Result = { driveFileId: string; name: string; webViewLink: string | null };

function useDriveExport() {
  const run = useOrgAction(exportVersionToDriveAction);
  const [last, setLast] = useState<Result | null>(null);
  async function send(versionId: string) {
    const res = await run.run({ versionId });
    if (!res.ok) return null;
    setLast(res.data);
    toast.success(
      <span className="flex flex-wrap items-center gap-2">
        <span>{res.data.name} salvo no Google Drive.</span>
        {res.data.webViewLink ? (
          <a href={res.data.webViewLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
            <ExternalLink className="size-3.5" /> Abrir no Drive
          </a>
        ) : null}
      </span>,
    );
    return res.data;
  }
  return { send, pending: run.pending, last };
}

/** Item de menu (ações de um arquivo). */
export function DriveExportMenuItem({ versionId }: { versionId: string }) {
  const { send, pending } = useDriveExport();
  return (
    <DropdownMenuItem disabled={pending} onSelect={() => void send(versionId)} data-testid="file-drive-export">
      <Cloud /> Salvar no Google Drive
    </DropdownMenuItem>
  );
}

/** Botão (página do arquivo). */
export function DriveExportButton({ versionId, size = "sm" }: { versionId: string; size?: "sm" | "xs" }) {
  const { send, pending, last } = useDriveExport();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" size={size} loading={pending} onClick={() => void send(versionId)}>
        <Cloud /> Salvar no Google Drive
      </Button>
      {last?.webViewLink ? (
        <a href={last.webViewLink} target="_blank" rel="noreferrer" className="text-xs underline">
          Abrir no Drive
        </a>
      ) : null}
    </span>
  );
}
