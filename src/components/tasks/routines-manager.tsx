"use client";

import { Pause, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate, todayISO } from "@/lib/format";
import { describeRule, upcoming, type RecurrenceRule } from "@/lib/recurrence";
import { deleteRoutineAction, saveRoutineAction, setRoutineActiveAction } from "@/server/actions/task-organization";
import type { RoutineRow } from "@/server/services/task-routines";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Project = { id: string; name: string; clientName: string };
type Member = { membershipId: string; name: string };

export function RoutineFormDialog({
  trigger,
  projects,
  members,
  routine,
}: {
  trigger: React.ReactNode;
  projects: Project[];
  members: Member[];
  routine?: RoutineRow;
}) {
  const { membershipId, permissions } = useWorkspace();
  const canAssign = permissions.includes("tasks.assign");
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceRule["frequency"]>(routine?.frequency ?? "weekly");
  const [interval, setInterval] = useState(routine?.interval ?? 1);
  const [weekday, setWeekday] = useState(routine?.weekday ?? 1);
  const [monthday, setMonthday] = useState(routine?.monthday ?? 1);
  const save = useOrgAction(saveRoutineAction, {
    success: routine ? "Rotina atualizada" : "Rotina criada",
    onSuccess: () => setOpen(false),
  });
  const rule: RecurrenceRule = { frequency, interval, weekday, monthday };
  const preview = useMemo(() => upcoming(rule, todayISO(), 3), [frequency, interval, weekday, monthday]); // eslint-disable-line react-hooks/exhaustive-deps
  const fe = save.fieldErrors;
  const assignable = canAssign ? members : members.filter((m) => m.membershipId === membershipId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save.run({
              id: routine?.id ?? null,
              projectId: String(f.get("projectId") ?? ""),
              title: String(f.get("title") ?? ""),
              description: String(f.get("description") ?? ""),
              assigneeMembershipId: String(f.get("assignee") ?? ""),
              priority: String(f.get("priority") ?? "medium") as "medium",
              frequency,
              interval,
              weekday: frequency === "weekly" ? weekday : null,
              monthday: frequency === "monthly" ? monthday : null,
              dueInDays: Number(f.get("dueInDays") ?? 0),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{routine ? "Editar rotina" : "Nova rotina"}</DialogTitle>
            <DialogDescription>
              A tarefa é criada automaticamente em cada data, no projeto escolhido, com o responsável e o prazo
              definidos aqui.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Título" htmlFor="r-title" required error={fe.title?.[0]} className="sm:col-span-2">
              <Input
                id="r-title"
                name="title"
                defaultValue={routine?.title}
                placeholder="Ex.: Escala de stories da agência"
              />
            </Field>
            <Field label="Projeto" htmlFor="r-project" required error={fe.projectId?.[0]} className="sm:col-span-2">
              <NativeSelect id="r-project" name="projectId" defaultValue={routine?.projectId ?? ""}>
                <option value="">Selecione…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName} · {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Frequência" htmlFor="r-frequency">
              <NativeSelect
                id="r-frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurrenceRule["frequency"])}
              >
                <option value="daily">Diária</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </NativeSelect>
            </Field>
            <Field
              label={
                frequency === "daily"
                  ? "A cada quantos dias"
                  : frequency === "weekly"
                    ? "A cada quantas semanas"
                    : "A cada quantos meses"
              }
              htmlFor="r-interval"
              error={fe.interval?.[0]}
            >
              <Input
                id="r-interval"
                type="number"
                min={1}
                max={12}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              />
            </Field>
            {frequency === "weekly" ? (
              <Field label="Dia da semana" htmlFor="r-weekday" error={fe.weekday?.[0]}>
                <NativeSelect id="r-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {frequency === "monthly" ? (
              <Field
                label="Dia do mês"
                htmlFor="r-monthday"
                hint="De 1 a 28 (existe em todos os meses)."
                error={fe.monthday?.[0]}
              >
                <Input
                  id="r-monthday"
                  type="number"
                  min={1}
                  max={28}
                  value={monthday}
                  onChange={(e) => setMonthday(Math.max(1, Math.min(28, Number(e.target.value) || 1)))}
                />
              </Field>
            ) : null}
            <Field
              label="Prazo da tarefa"
              htmlFor="r-due"
              hint="Dias depois da data (0 = no mesmo dia)."
              error={fe.dueInDays?.[0]}
            >
              <Input
                id="r-due"
                name="dueInDays"
                type="number"
                min={0}
                max={60}
                defaultValue={routine?.dueInDays ?? 0}
              />
            </Field>
            <Field label="Responsável" htmlFor="r-assignee">
              <NativeSelect
                id="r-assignee"
                name="assignee"
                defaultValue={routine?.assigneeMembershipId ?? membershipId}
              >
                <option value="">Sem responsável</option>
                {assignable.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prioridade" htmlFor="r-priority">
              <NativeSelect id="r-priority" name="priority" defaultValue={routine?.priority ?? "medium"}>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Descrição" htmlFor="r-desc" className="sm:col-span-2">
              <Textarea id="r-desc" name="description" rows={2} defaultValue={routine?.description ?? ""} />
            </Field>
            <p
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted sm:col-span-2"
              data-testid="routine-preview"
            >
              <span className="font-medium text-fg">{describeRule(rule)}.</span> Próximas:{" "}
              {preview.map((d) => formatDate(d)).join(", ")}.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={save.pending}>
              {routine ? "Salvar" : "Criar rotina"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RoutinesTable({
  rows,
  projects,
  members,
  canWrite,
}: {
  rows: RoutineRow[];
  projects: Project[];
  members: Member[];
  canWrite: boolean;
}) {
  const toggle = useOrgAction(setRoutineActiveAction);
  const remove = useOrgAction(deleteRoutineAction, { success: "Rotina excluída. As tarefas já criadas continuam." });
  if (!rows.length) {
    return (
      <EmptyState
        icon={Repeat}
        title="Nenhuma rotina ainda"
        description="Crie rotinas para tarefas que se repetem: organização de pastas, relatórios, escala de stories…"
        action={
          canWrite ? (
            <RoutineFormDialog
              projects={projects}
              members={members}
              trigger={
                <Button variant="primary">
                  <Plus /> Nova rotina
                </Button>
              }
            />
          ) : null
        }
      />
    );
  }
  return (
    <Table>
      <THead>
        <tr>
          <TH>Rotina</TH>
          <TH className="hidden whitespace-nowrap md:table-cell">Quando</TH>
          <TH className="hidden sm:table-cell">Próxima</TH>
          <TH className="hidden lg:table-cell">Responsável</TH>
          <TH className="hidden sm:table-cell">Criadas</TH>
          <TH className="w-28" aria-label="Ações" />
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id} data-routine-id={r.id}>
            <TD className="w-full max-w-0">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="block truncate text-xs text-fg-muted">
                {r.clientName} · {r.projectName}
              </span>
              <span className="block text-xs text-fg-muted sm:hidden">
                {r.active ? `Próxima: ${formatDate(r.nextRunOn)}` : "Pausada"}
              </span>
            </TD>
            <TD className="hidden text-sm whitespace-nowrap text-fg-muted md:table-cell">{r.ruleText}</TD>
            <TD className="hidden whitespace-nowrap sm:table-cell">
              {r.active ? <span className="text-sm">{formatDate(r.nextRunOn)}</span> : <Badge>Pausada</Badge>}
            </TD>
            <TD className="hidden text-sm whitespace-nowrap text-fg-muted lg:table-cell">
              {r.assigneeName ?? "Sem responsável"}
            </TD>
            <TD className="hidden tabular-nums sm:table-cell">{r.generated}</TD>
            <TD className="text-right">
              {canWrite ? (
                <span className="inline-flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={r.active ? `Pausar ${r.title}` : `Retomar ${r.title}`}
                    title={r.active ? "Pausar" : "Retomar"}
                    onClick={() => void toggle.run({ id: r.id, active: !r.active })}
                  >
                    {r.active ? <Pause /> : <Play />}
                  </Button>
                  <RoutineFormDialog
                    routine={r}
                    projects={projects}
                    members={members}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${r.title}`} title="Editar">
                        <Pencil />
                      </Button>
                    }
                  />
                  <ConfirmDialog
                    title={`Excluir a rotina “${r.title}”?`}
                    description="Novas tarefas deixam de ser criadas. As tarefas já criadas continuam no projeto."
                    confirmLabel="Excluir rotina"
                    onConfirm={() => remove.run({ id: r.id })}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${r.title}`} title="Excluir">
                        <Trash2 />
                      </Button>
                    }
                  />
                </span>
              ) : null}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
