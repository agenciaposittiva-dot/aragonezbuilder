"use client";

import { Check, Circle, CircleDot, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DueDate } from "@/components/app/due-date";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { deleteStageAction, saveStageAction, setStageStatusAction } from "@/server/actions/projects";

type Stage = { id: string; name: string; status: "pending" | "active" | "done"; dueDate: string | null };

const NEXT: Record<Stage["status"], Stage["status"]> = { pending: "active", active: "done", done: "pending" };

export function ProjectStages({
  projectId,
  stages,
  canWrite,
}: {
  projectId: string;
  stages: Stage[];
  canWrite: boolean;
}) {
  const [name, setName] = useState("");
  const setStatus = useOrgAction(setStageStatusAction);
  const save = useOrgAction(saveStageAction, { onSuccess: () => setName("") });
  const remove = useOrgAction(deleteStageAction, { success: "Etapa removida" });
  const done = stages.filter((s) => s.status === "done").length;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Etapas</CardTitle>
          <p className="mt-0.5 text-xs text-fg-muted">
            {done} de {stages.length} concluídas
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {stages.length ? (
          <ol className="relative grid gap-1">
            {stages.map((st, i) => (
              <li
                key={st.id}
                className="group relative flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-surface-2/60"
              >
                {i < stages.length - 1 ? (
                  <span className="absolute top-8 bottom-[-6px] left-[13px] w-px bg-border" aria-hidden="true" />
                ) : null}
                <button
                  type="button"
                  disabled={!canWrite || setStatus.pending}
                  onClick={() => setStatus.run({ projectId, stageId: st.id, status: NEXT[st.status] })}
                  className={cn(
                    "relative z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-surface transition-colors",
                    st.status === "done" && "border-success bg-success text-white",
                    st.status === "active" && "border-accent text-accent-text",
                    st.status === "pending" && "border-border-strong text-fg-subtle",
                    "ml-1 disabled:cursor-default",
                  )}
                  aria-label={`${st.name}: ${st.status === "done" ? "concluída" : st.status === "active" ? "em andamento" : "pendente"}. Clique para avançar.`}
                  title="Clique para avançar o status"
                >
                  {st.status === "done" ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : st.status === "active" ? (
                    <CircleDot className="size-3" />
                  ) : (
                    <Circle className="size-2.5" />
                  )}
                </button>
                <span
                  className={cn(
                    "flex-1 text-sm",
                    st.status === "done"
                      ? "text-fg-subtle line-through"
                      : st.status === "active"
                        ? "font-medium"
                        : "text-fg-muted",
                  )}
                >
                  {st.name}
                </span>
                {st.dueDate ? <DueDate date={st.dueDate} done={st.status === "done"} /> : null}
                {canWrite ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={`Remover etapa ${st.name}`}
                    onClick={() => remove.run({ projectId, stageId: st.id })}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-fg-muted">Nenhuma etapa definida.</p>
        )}
        {canWrite ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.run({ projectId, name: name.trim() });
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nova etapa"
              className="h-8"
              aria-label="Nome da nova etapa"
            />
            <Button type="submit" size="sm" variant="secondary" loading={save.pending} disabled={!name.trim()}>
              <Plus /> Adicionar
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
