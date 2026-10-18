"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import {
  deleteChecklistItemAction,
  reorderChecklistAction,
  saveChecklistItemAction,
  toggleChecklistItemAction,
} from "@/server/actions/tasks";

type Item = { id: string; title: string; done: boolean };

export function TaskChecklist({ taskId, items, canWrite }: { taskId: string; items: Item[]; canWrite: boolean }) {
  const [title, setTitle] = useState("");
  const add = useOrgAction(saveChecklistItemAction, { onSuccess: () => setTitle("") });
  const toggle = useOrgAction(toggleChecklistItemAction);
  const remove = useOrgAction(deleteChecklistItemAction);
  const reorder = useOrgAction(reorderChecklistAction);
  const done = items.filter((i) => i.done).length;

  function move(index: number, dir: -1 | 1) {
    const ids = items.map((i) => i.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.run({ taskId, orderedIds: ids });
  }

  return (
    <div className="grid gap-3">
      {items.length ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-success transition-[width]"
              style={{ width: `${Math.round((done / items.length) * 100)}%` }}
            />
          </div>
          <span className="tabular text-xs text-fg-subtle">
            {done}/{items.length}
          </span>
        </div>
      ) : null}
      <ul className="grid gap-0.5">
        {items.map((item, i) => (
          <li key={item.id} className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2/60">
            <Checkbox
              checked={item.done}
              disabled={!canWrite || toggle.pending}
              onCheckedChange={(v) => toggle.run({ taskId, itemId: item.id, done: v === true })}
              aria-label={item.title}
            />
            <span className={cn("flex-1 text-sm", item.done && "text-fg-subtle line-through")}>{item.title}</span>
            {canWrite ? (
              <span className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Mover para cima"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Mover para baixo"
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remover ${item.title}`}
                  onClick={() => remove.run({ taskId, itemId: item.id })}
                >
                  <Trash2 />
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) add.run({ taskId, title: title.trim() });
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Novo item"
            className="h-8"
            aria-label="Novo item do checklist"
          />
          <Button type="submit" size="sm" variant="secondary" loading={add.pending} disabled={!title.trim()}>
            <Plus /> Adicionar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
