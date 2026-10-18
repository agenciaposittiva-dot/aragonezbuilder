"use client";

import { ArrowDown, ArrowUp, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemberLite } from "@/components/app/member-picker";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { formatMinutes, todayISO } from "@/lib/format";
import { parseDuration } from "@/lib/validators/tasks";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { applyTemplateAction, deleteTemplateAction, saveTemplateAction } from "@/server/actions/task-organization";
import type { ProjectOption } from "./task-form-dialog";

type Priority = "low" | "medium" | "high" | "urgent";

export type TemplateDraft = {
  id?: string;
  name: string;
  description: string | null;
  priority: Priority;
  dueOffsetDays: number | null;
  estimateMinutes: number | null;
  checklist: string[];
  steps: { title: string; dueOffsetDays: number | null; estimateMinutes: number | null; checklist: string[] }[];
};

const EMPTY: TemplateDraft = {
  name: "",
  description: null,
  priority: "medium",
  dueOffsetDays: null,
  estimateMinutes: null,
  checklist: [],
  steps: [],
};

const lines = (v: string) =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

type StepForm = { title: string; offset: string; estimate: string; checklist: string };

/** Criar ou editar um modelo de processo (tarefa principal + etapas). */
export function TemplateEditorDialog({
  trigger,
  initial,
  defaultOpen = false,
}: {
  trigger?: React.ReactNode;
  initial?: TemplateDraft;
  defaultOpen?: boolean;
}) {
  const start = initial ?? EMPTY;
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description ?? "");
  const [priority, setPriority] = useState<Priority>(start.priority);
  const [offset, setOffset] = useState(start.dueOffsetDays === null ? "" : String(start.dueOffsetDays));
  const [checklist, setChecklist] = useState(start.checklist.join("\n"));
  const [steps, setSteps] = useState<StepForm[]>(
    start.steps.map((s) => ({
      title: s.title,
      offset: s.dueOffsetDays === null ? "" : String(s.dueOffsetDays),
      estimate: s.estimateMinutes ? formatMinutes(s.estimateMinutes) : "",
      checklist: s.checklist.join("\n"),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useOrgAction(saveTemplateAction, {
    success: initial?.id ? "Modelo atualizado" : "Modelo criado",
    onSuccess: () => setOpen(false),
  });
  const fe = save.fieldErrors;

  const setStep = (i: number, patch: Partial<StepForm>) =>
    setSteps((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function submit() {
    setError(null);
    const parsed = [];
    for (const [i, s] of steps.entries()) {
      if (!s.title.trim()) continue;
      const est = s.estimate.trim() ? parseDuration(s.estimate) : null;
      if (s.estimate.trim() && !est) {
        setError(`Estimativa inválida na etapa ${i + 1} (ex.: 2h, 45min).`);
        return;
      }
      parsed.push({
        title: s.title.trim(),
        dueOffsetDays: s.offset.trim() === "" ? null : Number(s.offset),
        estimateMinutes: est,
        checklist: lines(s.checklist),
      });
    }
    save.run({
      id: initial?.id,
      name,
      description,
      priority,
      dueOffsetDays: offset.trim() === "" ? null : Number(offset),
      checklist: lines(checklist),
      steps: parsed,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar modelo" : "Novo modelo de tarefa"}</DialogTitle>
          <DialogDescription>
            Ao aplicar, o modelo cria a tarefa principal com as etapas como subtarefas. Os prazos são contados em dias a
            partir da data de início escolhida.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label="Nome" htmlFor="tpl-name" required error={fe.name}>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Prioridade" htmlFor="tpl-priority">
              <NativeSelect
                id="tpl-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Descrição" htmlFor="tpl-desc">
            <Textarea id="tpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <Field
              label="Prazo final (dias)"
              htmlFor="tpl-offset"
              hint="Vazio: usa a última etapa."
              error={fe.dueOffsetDays}
            >
              <Input
                id="tpl-offset"
                type="number"
                min={0}
                max={365}
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
            </Field>
            <Field label="Checklist da tarefa principal" htmlFor="tpl-checklist" hint="Um item por linha.">
              <Textarea id="tpl-checklist" rows={2} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Etapas</h3>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSteps((s) => [...s, { title: "", offset: "", estimate: "", checklist: "" }])}
                disabled={steps.length >= 40}
              >
                <Plus /> Etapa
              </Button>
            </div>
            {steps.length === 0 ? (
              <p className="text-sm text-fg-muted">Sem etapas: o modelo cria só a tarefa principal.</p>
            ) : (
              <ol className="grid gap-2">
                {steps.map((s, i) => (
                  <li key={i} className="grid gap-2 rounded-lg border border-border p-2.5">
                    <div className="flex items-start gap-2">
                      <span className="tabular mt-2 w-5 shrink-0 text-xs text-fg-subtle">{i + 1}.</span>
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_96px_96px]">
                        <Input
                          value={s.title}
                          onChange={(e) => setStep(i, { title: e.target.value })}
                          placeholder="Nome da etapa"
                          aria-label={`Nome da etapa ${i + 1}`}
                          className="h-8"
                          maxLength={300}
                        />
                        <Input
                          type="number"
                          min={0}
                          max={365}
                          value={s.offset}
                          onChange={(e) => setStep(i, { offset: e.target.value })}
                          placeholder="Dia"
                          aria-label={`Prazo da etapa ${i + 1} em dias`}
                          title="Prazo em dias a partir do início"
                          className="h-8"
                        />
                        <Input
                          value={s.estimate}
                          onChange={(e) => setStep(i, { estimate: e.target.value })}
                          placeholder="Estimativa"
                          aria-label={`Estimativa da etapa ${i + 1}`}
                          className="h-8"
                        />
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Subir etapa"
                          disabled={i === 0}
                          onClick={() => moveStep(i, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Descer etapa"
                          disabled={i === steps.length - 1}
                          onClick={() => moveStep(i, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remover etapa ${i + 1}`}
                          onClick={() => setSteps((list) => list.filter((_, j) => j !== i))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <details className="ml-7 text-xs text-fg-muted">
                      <summary className="cursor-pointer select-none">
                        Checklist{lines(s.checklist).length ? ` (${lines(s.checklist).length})` : ""}
                      </summary>
                      <Textarea
                        rows={2}
                        value={s.checklist}
                        onChange={(e) => setStep(i, { checklist: e.target.value })}
                        placeholder="Um item por linha"
                        aria-label={`Checklist da etapa ${i + 1}`}
                        className="mt-1.5"
                      />
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {error || save.fieldErrors.steps ? (
            <p role="alert" className="text-sm text-danger">
              {error ?? save.fieldErrors.steps?.[0]}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.pending} disabled={!name.trim()} onClick={submit}>
            Salvar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const remove = useOrgAction(deleteTemplateAction, { success: "Modelo excluído" });
  return (
    <ConfirmDialog
      title={`Excluir o modelo “${name}”?`}
      description="Tarefas já criadas a partir dele não são alteradas."
      confirmLabel="Excluir modelo"
      onConfirm={() => remove.run({ id })}
      trigger={
        <Button size="sm" variant="ghost" aria-label={`Excluir ${name}`}>
          <Trash2 /> Excluir
        </Button>
      }
    />
  );
}

/** Aplicar um modelo num projeto. */
export function ApplyTemplateDialog({
  trigger,
  templates,
  projects,
  members,
  defaultTemplateId,
  defaultProjectId,
}: {
  trigger: React.ReactNode;
  templates: { id: string; name: string; steps: number }[];
  projects: ProjectOption[];
  members: MemberLite[];
  defaultTemplateId?: string;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const { orgSlug, membershipId, permissions } = useWorkspace();
  const canAssign = permissions.includes("tasks.assign");
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? templates[0]?.id ?? "");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [assignee, setAssignee] = useState("");
  const apply = useOrgAction(applyTemplateAction, {
    success: "Tarefas criadas a partir do modelo",
    onSuccess: (d) => {
      setOpen(false);
      router.push(`/w/${orgSlug}/tasks/${d.id}`);
    },
  });
  const chosen = templates.find((t) => t.id === templateId);
  const assignable = canAssign ? members : members.filter((m) => m.membershipId === membershipId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Criar tarefas a partir de um modelo</DialogTitle>
          <DialogDescription>
            {chosen
              ? `Cria a tarefa principal e ${chosen.steps} etapa${chosen.steps === 1 ? "" : "s"}, com prazos contados a partir do início.`
              : "Escolha o modelo e o projeto."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {templates.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Nenhum modelo ainda. Crie um em Modelos ou salve uma tarefa como modelo.
            </p>
          ) : (
            <>
              <Field label="Modelo" htmlFor="apply-template" required error={apply.fieldErrors.templateId}>
                <NativeSelect id="apply-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Projeto" htmlFor="apply-project" required error={apply.fieldErrors.projectId}>
                <NativeSelect id="apply-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Escolha o projeto…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.clientName} · {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Título da tarefa principal" htmlFor="apply-title" hint="Vazio: usa o nome do modelo.">
                <Input
                  id="apply-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={chosen?.name}
                  maxLength={300}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Início" htmlFor="apply-start" error={apply.fieldErrors.startDate}>
                  <Input
                    id="apply-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                <Field label="Responsável" htmlFor="apply-assignee" error={apply.fieldErrors.assigneeMembershipId}>
                  <NativeSelect id="apply-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Sem responsável</option>
                    {assignable.map((m) => (
                      <option key={m.membershipId} value={m.membershipId}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={apply.pending}
            disabled={!templateId || !projectId}
            onClick={() =>
              apply.run({ templateId, projectId, title, startDate, assigneeMembershipId: assignee || null })
            }
          >
            <LayoutTemplate /> Criar tarefas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
