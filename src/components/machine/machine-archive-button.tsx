"use client";

import { Button } from "@/components/ui/button";
import { useOrgAction } from "@/hooks/use-action";
import { archiveMachineProjectAction } from "@/server/actions/content-machine";

export function MachineArchiveButton({ id, archived, icon }: { id: string; archived: boolean; icon: React.ReactNode }) {
  const action = useOrgAction(archiveMachineProjectAction, {
    success: archived ? "Projeto de volta à Máquina" : "Projeto arquivado",
  });
  return (
    <Button
      variant="secondary"
      size="icon-xs"
      className="shadow-sm"
      aria-label={archived ? "Desarquivar projeto" : "Arquivar projeto"}
      title={archived ? "Desarquivar" : "Arquivar"}
      loading={action.pending}
      onClick={() => void action.run({ id, archived: !archived })}
    >
      {icon}
    </Button>
  );
}
