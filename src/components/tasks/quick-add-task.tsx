"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { createTaskAction } from "@/server/actions/tasks";
import type { ProjectOption } from "./task-form-dialog";

/** Adição rápida: título + Enter. Sem projeto fixo, pede o projeto num seletor compacto. */
export function QuickAddTask({
  statusId,
  projectId,
  projects,
  assigneeMembershipId,
  className,
}: {
  statusId?: string;
  projectId?: string;
  projects?: ProjectOption[];
  assigneeMembershipId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(projectId ?? projects?.[0]?.id ?? "");
  const input = useRef<HTMLInputElement>(null);
  const create = useOrgAction(createTaskAction, {
    onSuccess: () => {
      setTitle("");
      input.current?.focus();
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg",
          className,
        )}
      >
        <Plus className="size-3.5" /> Adicionar tarefa
      </button>
    );
  }

  return (
    <form
      className={cn("grid gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-xs", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !project) return;
        create.run({
          projectId: project,
          title: title.trim(),
          statusId: statusId ?? null,
          assigneeMembershipId: assigneeMembershipId ?? null,
        });
      }}
    >
      <input
        ref={input}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Título da tarefa"
        aria-label="Título da nova tarefa"
        className="w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle"
        disabled={create.pending}
      />
      {!projectId && projects ? (
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          aria-label="Projeto"
          className="w-full rounded border border-border bg-surface-2 px-1.5 py-1 text-xs text-fg-muted"
        >
          {projects.length === 0 ? <option value="">Nenhum projeto</option> : null}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.clientName} · {p.name}
            </option>
          ))}
        </select>
      ) : null}
      <div className="flex items-center justify-between text-[11px] text-fg-subtle">
        <span>Enter para salvar · Esc para fechar</span>
        <button type="button" onClick={() => setOpen(false)} className="hover:text-fg">
          Fechar
        </button>
      </div>
    </form>
  );
}
