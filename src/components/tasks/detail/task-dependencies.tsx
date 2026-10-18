"use client";

import { Link2, Lock, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { addDependencyAction, removeDependencyAction } from "@/server/actions/tasks";

type Dep = { id: string; title: string; completedAt: Date | null; statusName: string; statusColor: string };

export function TaskDependencies({
  taskId,
  dependsOn,
  blocking,
  options,
  canWrite,
}: {
  taskId: string;
  dependsOn: Dep[];
  blocking: Dep[];
  options: { id: string; title: string }[];
  canWrite: boolean;
}) {
  const { orgSlug } = useWorkspace();
  const [selected, setSelected] = useState("");
  const add = useOrgAction(addDependencyAction, { onSuccess: () => setSelected("") });
  const remove = useOrgAction(removeDependencyAction);
  const available = options.filter(
    (o) => !dependsOn.some((d) => d.id === o.id) && !blocking.some((b) => b.id === o.id),
  );
  const pending = dependsOn.filter((d) => !d.completedAt).length;

  const row = (d: Dep, removable: boolean) => (
    <li key={d.id} className="flex items-center gap-2 py-1.5">
      <Link
        href={`/w/${orgSlug}/tasks/${d.id}`}
        className={cn(
          "min-w-0 flex-1 truncate text-sm hover:underline",
          d.completedAt && "text-fg-subtle line-through",
        )}
      >
        {d.title}
      </Link>
      <StatusBadge name={d.statusName} color={d.statusColor} />
      {removable && canWrite ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remover dependência de ${d.title}`}
          onClick={() => remove.run({ taskId, dependsOnTaskId: d.id })}
        >
          <X />
        </Button>
      ) : null}
    </li>
  );

  return (
    <div className="grid gap-4">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Lock className="size-3.5" /> Depende de
          {pending ? (
            <span className="text-warning">
              ({pending} pendente{pending > 1 ? "s" : ""}: não pode ser concluída ainda)
            </span>
          ) : null}
        </p>
        {dependsOn.length ? (
          <ul className="divide-y divide-border">{dependsOn.map((d) => row(d, true))}</ul>
        ) : (
          <p className="text-sm text-fg-subtle">Nenhuma.</p>
        )}
      </div>
      {blocking.length ? (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <Link2 className="size-3.5" /> Bloqueia
          </p>
          <ul className="divide-y divide-border">{blocking.map((d) => row(d, false))}</ul>
        </div>
      ) : null}
      {canWrite && available.length ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (selected) add.run({ taskId, dependsOnTaskId: selected });
          }}
        >
          <div className="min-w-0 flex-1">
            <NativeSelect
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-8 text-[13px]"
              aria-label="Tarefa da qual esta depende"
            >
              <option value="">Adicionar dependência…</option>
              {available.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={!selected} loading={add.pending}>
            Adicionar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
