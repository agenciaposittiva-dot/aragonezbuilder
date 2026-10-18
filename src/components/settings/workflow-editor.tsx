"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge, STATUS_COLOR_NAMES, StatusBadge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import {
  deleteStatusAction,
  reorderStatusesAction,
  saveStatusAction,
  setDefaultStatusAction,
  setTransitionsAction,
} from "@/server/actions/settings";

type Status = {
  id: string;
  name: string;
  category: "backlog" | "todo" | "in_progress" | "review" | "done" | "cancelled";
  color: string;
  isDefault: boolean;
};

const CATEGORY_LABEL: Record<Status["category"], string> = {
  backlog: "Backlog / pausado",
  todo: "A fazer",
  in_progress: "Em andamento",
  review: "Em revisão",
  done: "Concluído",
  cancelled: "Cancelado",
};

export function WorkflowEditor({
  entity,
  title,
  description,
  statuses,
  transitions,
}: {
  entity: "project" | "task";
  title: string;
  description: string;
  statuses: Status[];
  transitions: { fromStatusId: string; toStatusId: string }[];
}) {
  const [editing, setEditing] = useState<Partial<Status> | null>(null);
  const save = useOrgAction(saveStatusAction, { success: "Status salvo", onSuccess: () => setEditing(null) });
  const remove = useOrgAction(deleteStatusAction, { success: "Status excluído" });
  const reorder = useOrgAction(reorderStatusesAction);
  const setDefault = useOrgAction(setDefaultStatusAction, { success: "Status padrão definido" });
  const setTrans = useOrgAction(setTransitionsAction, { success: "Transições atualizadas" });

  const allowed = (from: string) => transitions.filter((t) => t.fromStatusId === from).map((t) => t.toStatusId);

  function move(index: number, delta: number) {
    const ids = statuses.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    reorder.run({ entity, orderedIds: ids });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEditing({ category: "todo", color: "slate" })}>
          <Plus /> Novo status
        </Button>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ul className="grid divide-y divide-border rounded-lg border border-border">
          {statuses.map((st, i) => (
            <li key={st.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={i === 0 || reorder.pending}
                  onClick={() => move(i, -1)}
                  className="text-fg-subtle hover:text-fg disabled:opacity-30"
                  aria-label={`Mover ${st.name} para cima`}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={i === statuses.length - 1 || reorder.pending}
                  onClick={() => move(i, 1)}
                  className="text-fg-subtle hover:text-fg disabled:opacity-30"
                  aria-label={`Mover ${st.name} para baixo`}
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
              <StatusBadge name={st.name} color={st.color} />
              <span className="text-xs text-fg-muted">{CATEGORY_LABEL[st.category]}</span>
              {st.isDefault ? <Badge tone="accent">Padrão para novos</Badge> : null}
              <span className="flex-1" />
              {!st.isDefault ? (
                <Button variant="ghost" size="xs" onClick={() => setDefault.run({ entity, id: st.id })}>
                  <Star /> Tornar padrão
                </Button>
              ) : null}
              <Button variant="ghost" size="icon-xs" aria-label={`Editar ${st.name}`} onClick={() => setEditing(st)}>
                <Pencil />
              </Button>
              <ConfirmDialog
                title={`Excluir "${st.name}"?`}
                description="Só é possível excluir status sem registros. Mova os itens antes."
                confirmLabel="Excluir"
                onConfirm={() => remove.run({ entity, id: st.id })}
                trigger={
                  <Button variant="ghost" size="icon-xs" aria-label={`Excluir ${st.name}`} disabled={st.isDefault}>
                    <Trash2 />
                  </Button>
                }
              />
            </li>
          ))}
        </ul>

        <div>
          <h3 className="text-sm font-semibold">Transições permitidas</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Marque para onde cada status pode ir. Uma linha sem marcações significa fluxo livre a partir daquele status.
          </p>
          <div className="mt-3 scrollbar-thin overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-fg-subtle">De ↓ / Para →</th>
                  {statuses.map((to) => (
                    <th
                      key={to.id}
                      className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap text-fg-muted"
                    >
                      <span className="inline-flex items-center gap-1">
                        <StatusDot color={to.color} />
                        {to.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statuses.map((from) => {
                  const targets = allowed(from.id);
                  return (
                    <tr key={from.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot color={from.color} />
                          {from.name}
                          {targets.length === 0 ? <span className="text-[11px] text-fg-subtle">(livre)</span> : null}
                        </span>
                      </td>
                      {statuses.map((to) => (
                        <td key={to.id} className={cn("px-2 py-2 text-center", from.id === to.id && "bg-surface-2/60")}>
                          {from.id === to.id ? (
                            <span className="text-fg-subtle">—</span>
                          ) : (
                            <Checkbox
                              aria-label={`Permitir ${from.name} → ${to.name}`}
                              checked={targets.includes(to.id)}
                              disabled={setTrans.pending}
                              onCheckedChange={(v) =>
                                setTrans.run({
                                  fromStatusId: from.id,
                                  toStatusIds: v ? [...targets, to.id] : targets.filter((x) => x !== to.id),
                                })
                              }
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="sm">
          {editing ? (
            <form
              className="flex min-h-0 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save.run({
                  id: editing.id,
                  entity,
                  name: String(f.get("name") ?? ""),
                  category: String(f.get("category")) as Status["category"],
                  color: String(f.get("color") ?? "slate"),
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>{editing.id ? "Editar status" : "Novo status"}</DialogTitle>
              </DialogHeader>
              <DialogBody className="grid gap-4">
                <Field label="Nome" htmlFor="st-name" required error={save.fieldErrors.name}>
                  <Input id="st-name" name="name" defaultValue={editing.name ?? ""} required autoFocus />
                </Field>
                <Field
                  label="Categoria"
                  htmlFor="st-cat"
                  hint="Define o significado nos relatórios e regras (ex.: só “Concluído” encerra a tarefa)."
                >
                  <NativeSelect id="st-cat" name="category" defaultValue={editing.category ?? "todo"}>
                    {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Cor">
                  <div className="flex flex-wrap gap-2">
                    {STATUS_COLOR_NAMES.map((c) => (
                      <label key={c} className="cursor-pointer">
                        <input
                          type="radio"
                          name="color"
                          value={c}
                          defaultChecked={(editing.color ?? "slate") === c}
                          className="peer sr-only"
                        />
                        <span className="flex size-7 items-center justify-center rounded-full border border-border peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                          <StatusDot color={c} className="size-3.5" />
                        </span>
                        <span className="sr-only">{c}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={save.pending}>
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
