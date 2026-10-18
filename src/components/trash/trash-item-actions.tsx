"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useOrgAction } from "@/hooks/use-action";
import { purgeFromTrashAction, restoreFromTrashAction } from "@/server/actions/trash";

const WHAT = {
  client:
    "O cliente e tudo o que é dele — projetos, tarefas, arquivos, aprovações, solicitações, artes, faturas e acessos ao portal — serão apagados. As despesas da agência ficam, sem o vínculo.",
  project:
    "O projeto, as tarefas, os comentários e as horas registradas serão apagados. Arquivos, artes, solicitações e faturas continuam no cliente, sem o vínculo com o projeto.",
  design: "A arte será apagada. Arquivos já exportados continuam na central de arquivos.",
} as const;

export function TrashItemActions({
  kind,
  id,
  name,
  blocked,
}: {
  kind: keyof typeof WHAT;
  id: string;
  name: string;
  blocked: boolean;
}) {
  const restore = useOrgAction(restoreFromTrashAction, { success: `“${name}” restaurado` });
  const purge = useOrgAction(purgeFromTrashAction, { success: `“${name}” excluído definitivamente` });
  return (
    <div className="flex shrink-0 gap-2">
      <Button
        variant="secondary"
        size="sm"
        loading={restore.pending}
        disabled={blocked || purge.pending}
        onClick={() => restore.run({ kind, id })}
      >
        <RotateCcw /> Restaurar
      </Button>
      <ConfirmDialog
        title={`Excluir “${name}” definitivamente?`}
        description={
          <>
            {WHAT[kind]} <strong className="font-semibold text-fg">Isso não pode ser desfeito.</strong>
          </>
        }
        confirmLabel="Excluir definitivamente"
        onConfirm={() => purge.run({ kind, id })}
        trigger={
          <Button variant="danger-ghost" size="sm" disabled={restore.pending}>
            <Trash2 /> Excluir definitivamente
          </Button>
        }
      />
    </div>
  );
}
