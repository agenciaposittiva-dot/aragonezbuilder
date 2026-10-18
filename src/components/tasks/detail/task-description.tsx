"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { updateTaskAction } from "@/server/actions/tasks";

export function TaskDescription({
  taskId,
  description,
  canWrite,
}: {
  taskId: string;
  description: string | null;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description ?? "");
  const update = useOrgAction(updateTaskAction, { success: "Descrição salva", onSuccess: () => setEditing(false) });

  if (editing) {
    return (
      <div className="grid gap-2">
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={8} autoFocus aria-label="Descrição" />
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setValue(description ?? "");
              setEditing(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={update.pending}
            onClick={() => update.run({ id: taskId, description: value })}
          >
            Salvar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="group relative">
      {description ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg">{description}</p>
      ) : (
        <p className="text-sm text-fg-subtle">Sem descrição.</p>
      )}
      {canWrite ? (
        <Button variant="ghost" size="xs" className="mt-2" onClick={() => setEditing(true)}>
          <Pencil /> {description ? "Editar descrição" : "Adicionar descrição"}
        </Button>
      ) : null}
    </div>
  );
}
