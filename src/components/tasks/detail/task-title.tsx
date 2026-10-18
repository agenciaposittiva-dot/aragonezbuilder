"use client";

import { useState } from "react";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { updateTaskAction } from "@/server/actions/tasks";

/** Título editável no lugar (clique para editar; Enter salva, Esc cancela). */
export function TaskTitle({
  taskId,
  title,
  canWrite,
  done,
}: {
  taskId: string;
  title: string;
  canWrite: boolean;
  done: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const update = useOrgAction(updateTaskAction, { onSuccess: () => setEditing(false) });

  if (!canWrite || !editing) {
    return (
      <h1
        className={cn(
          "text-xl leading-snug font-semibold tracking-tight",
          done && "text-fg-subtle line-through",
          canWrite && "-mx-1.5 cursor-text rounded-md px-1.5 hover:bg-surface-2",
        )}
        onClick={() => canWrite && setEditing(true)}
        title={canWrite ? "Clique para editar" : undefined}
      >
        {title}
      </h1>
    );
  }
  const save = () => {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      setEditing(false);
      return;
    }
    update.run({ id: taskId, title: next });
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setValue(title);
          setEditing(false);
        }
      }}
      disabled={update.pending}
      aria-label="Título da tarefa"
      maxLength={300}
      className="-mx-1.5 w-full rounded-md border border-accent bg-surface px-1.5 text-xl leading-snug font-semibold tracking-tight outline-none"
    />
  );
}
