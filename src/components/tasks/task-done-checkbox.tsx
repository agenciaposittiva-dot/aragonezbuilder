"use client";

import { Check } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/shell/workspace-context";
import { cn } from "@/lib/utils";
import { toggleTaskDoneAction } from "@/server/actions/tasks";

/** Marca/desmarca a tarefa como concluída (com atualização otimista). */
export function TaskDoneCheckbox({
  taskId,
  done,
  disabled,
  label,
}: {
  taskId: string;
  done: boolean;
  disabled?: boolean;
  label: string;
}) {
  const { orgSlug } = useWorkspace();
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={optimistic}
      aria-label={optimistic ? `Reabrir: ${label}` : `Concluir: ${label}`}
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          const res = await toggleTaskDoneAction(orgSlug, { taskId, done: !optimistic });
          if (!res.ok) toast.error(res.error);
        })
      }
      className={cn(
        "relative z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed",
        optimistic ? "border-success bg-success text-white" : "border-border-strong bg-surface hover:border-success",
      )}
    >
      {optimistic ? <Check className="size-3" strokeWidth={3} /> : null}
    </button>
  );
}
