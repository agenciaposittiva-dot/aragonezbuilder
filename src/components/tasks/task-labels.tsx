"use client";

import { Check, Pencil, Plus, Search, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { STATUS_COLORS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { LABEL_COLORS } from "@/lib/validators/tasks";
import { deleteLabelAction, saveLabelAction, setTaskLabelsAction } from "@/server/actions/task-organization";

export type LabelLite = { id: string; name: string; color: string };

const COLOR_NAME: Record<(typeof LABEL_COLORS)[number], string> = {
  slate: "Grafite",
  zinc: "Cinza",
  blue: "Azul",
  sky: "Céu",
  amber: "Âmbar",
  orange: "Laranja",
  violet: "Violeta",
  pink: "Rosa",
  green: "Verde",
  teal: "Turquesa",
  red: "Vermelho",
};

/** Etiqueta compacta (lista, quadro, detalhe). */
export function LabelChip({ label, className }: { label: LabelLite; className?: string }) {
  const c = STATUS_COLORS[label.color] ?? STATUS_COLORS.slate!;
  return (
    <span
      className={cn(
        "inline-flex max-w-40 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        c.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", c.dot)} aria-hidden="true" />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

export function LabelList({ labels, max = 3 }: { labels: LabelLite[]; max?: number }) {
  if (!labels.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {labels.slice(0, max).map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {labels.length > max ? <span className="text-[11px] text-fg-subtle">+{labels.length - max}</span> : null}
    </span>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: (typeof LABEL_COLORS)[number]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_NAME[c]}
          title={COLOR_NAME[c]}
          onClick={() => onChange(c)}
          className={cn(
            "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-surface",
            STATUS_COLORS[c]!.dot,
            value === c && "ring-2 ring-fg",
          )}
        >
          {value === c ? <Check className="size-3.5 text-white" /> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Etiquetas de uma tarefa: marcar/desmarcar com busca e criar uma nova na
 * hora. A mudança aparece imediatamente e volta se o servidor recusar.
 */
export function TaskLabelsPicker({
  taskId,
  labels,
  value,
  canWrite,
}: {
  taskId: string;
  labels: LabelLite[];
  value: LabelLite[];
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState<LabelLite[] | null>(null);
  const [extra, setExtra] = useState<LabelLite[]>([]);
  const selected = current ?? value;
  const all = useMemo(() => [...labels, ...extra.filter((e) => !labels.some((l) => l.id === e.id))], [labels, extra]);
  const filtered = all.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = all.some((l) => l.name.toLowerCase() === q.trim().toLowerCase());
  const setLabels = useOrgAction(setTaskLabelsAction);
  const create = useOrgAction(saveLabelAction, { success: "Etiqueta criada" });

  async function apply(next: LabelLite[]) {
    const before = selected;
    setCurrent(next);
    const res = await setLabels.run({ taskId, labelIds: next.map((l) => l.id) });
    if (!res.ok) setCurrent(before);
  }

  if (!canWrite)
    return selected.length ? <LabelList labels={selected} max={10} /> : <span className="text-fg-subtle">—</span>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-surface-2"
          aria-label="Etiquetas"
        >
          {selected.length ? (
            <LabelList labels={selected} max={10} />
          ) : (
            <span className="flex items-center gap-1 text-fg-subtle">
              <Tag className="size-3.5" /> Adicionar etiqueta
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-fg-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ou criar etiqueta…"
            aria-label="Buscar etiqueta"
            maxLength={40}
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          />
        </div>
        <ul className="max-h-64 scrollbar-thin overflow-y-auto p-1" role="listbox" aria-multiselectable>
          {filtered.map((l) => {
            const on = selected.some((s) => s.id === l.id);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => void apply(on ? selected.filter((s) => s.id !== l.id) : [...selected, l])}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                >
                  <span className="flex size-4 items-center justify-center rounded border border-border">
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  <LabelChip label={l} />
                </button>
              </li>
            );
          })}
          {q.trim() && !exact ? (
            <li>
              <button
                type="button"
                disabled={create.pending}
                onClick={async () => {
                  const name = q.trim();
                  const res = await create.run({ name, color: "blue" });
                  if (res.ok) {
                    const label = { id: res.data.id, name, color: "blue" };
                    setExtra((e) => [...e, label]);
                    setQ("");
                    await apply([...selected, label]);
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-accent-text hover:bg-surface-2"
              >
                <Plus className="size-4" /> Criar “{q.trim()}”
              </button>
            </li>
          ) : null}
          {!filtered.length && !q.trim() ? (
            <li className="px-2 py-3 text-center text-xs text-fg-muted">Nenhuma etiqueta ainda. Digite para criar.</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Gerenciar etiquetas da organização (renomear, recolorir, excluir). */
export function LabelManager({ labels, canManage }: { labels: (LabelLite & { uses: number })[]; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; color: (typeof LABEL_COLORS)[number] }>({
    name: "",
    color: "blue",
  });
  const [creating, setCreating] = useState({ name: "", color: "blue" as (typeof LABEL_COLORS)[number] });
  const save = useOrgAction(saveLabelAction, { success: "Etiqueta salva", onSuccess: () => setEditing(null) });
  const add = useOrgAction(saveLabelAction, {
    success: "Etiqueta criada",
    onSuccess: () => setCreating({ name: "", color: "blue" }),
  });
  const remove = useOrgAction(deleteLabelAction, { success: "Etiqueta excluída" });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Tag /> Etiquetas
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Etiquetas</DialogTitle>
          <DialogDescription>
            Use etiquetas para agrupar tarefas por tema, formato ou campanha. Excluir uma etiqueta a remove de todas as
            tarefas.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <form
            className="grid gap-2 rounded-lg border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (creating.name.trim()) add.run({ name: creating.name, color: creating.color });
            }}
          >
            <div className="flex gap-2">
              <Input
                value={creating.name}
                onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))}
                placeholder="Nova etiqueta"
                aria-label="Nome da nova etiqueta"
                maxLength={40}
                className="h-8"
              />
              <Button type="submit" size="sm" variant="primary" loading={add.pending} disabled={!creating.name.trim()}>
                <Plus /> Criar
              </Button>
            </div>
            <ColorPicker value={creating.color} onChange={(color) => setCreating((c) => ({ ...c, color }))} />
            {add.fieldErrors.name ? <p className="text-xs text-danger">{add.fieldErrors.name[0]}</p> : null}
          </form>
          {labels.length ? (
            <ul className="grid divide-y divide-border rounded-lg border border-border">
              {labels.map((l) =>
                editing === l.id ? (
                  <li key={l.id} className="grid gap-2 p-3">
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      aria-label="Nome da etiqueta"
                      maxLength={40}
                      className="h-8"
                    />
                    <ColorPicker value={draft.color} onChange={(color) => setDraft((d) => ({ ...d, color }))} />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={save.pending}
                        disabled={!draft.name.trim()}
                        onClick={() => save.run({ id: l.id, name: draft.name, color: draft.color })}
                      >
                        Salvar
                      </Button>
                    </div>
                  </li>
                ) : (
                  <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                    <LabelChip label={l} />
                    <span className="text-xs text-fg-subtle">
                      {l.uses} {l.uses === 1 ? "tarefa" : "tarefas"}
                    </span>
                    <span className="flex-1" />
                    {canManage ? (
                      <>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Editar ${l.name}`}
                          onClick={() => {
                            setDraft({ name: l.name, color: l.color as (typeof LABEL_COLORS)[number] });
                            setEditing(l.id);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <ConfirmDialog
                          title={`Excluir a etiqueta “${l.name}”?`}
                          description={`Ela sai de ${l.uses} ${l.uses === 1 ? "tarefa" : "tarefas"}. As tarefas não são alteradas de outra forma.`}
                          confirmLabel="Excluir etiqueta"
                          onConfirm={() => remove.run({ id: l.id })}
                          trigger={
                            <Button size="icon-xs" variant="ghost" aria-label={`Excluir ${l.name}`}>
                              <Trash2 />
                            </Button>
                          }
                        />
                      </>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">Nenhuma etiqueta criada.</p>
          )}
          {!canManage ? (
            <p className="text-xs text-fg-subtle">Renomear e excluir etiquetas é de quem gerencia a organização.</p>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
