"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MemberPicker, type MemberLite } from "@/components/app/member-picker";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { AvatarGroup } from "@/components/ui/avatar";
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
import { parseDuration } from "@/lib/validators/tasks";
import { createTaskAction } from "@/server/actions/tasks";

export type ProjectOption = { id: string; name: string; clientName: string; clientId?: string };

export function TaskFormDialog({
  trigger,
  projects,
  members,
  defaultProjectId,
  defaultStatusId,
  parentTaskId,
  openAfterCreate = true,
  noun = "tarefa",
  defaultAssigneeId,
  defaultDueDate,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Sem gatilho, o diálogo é controlado por `open`/`onOpenChange` (ex.: criar a partir de um dia do calendário). */
  trigger?: React.ReactNode;
  projects: ProjectOption[];
  members: MemberLite[];
  defaultProjectId?: string;
  defaultStatusId?: string;
  parentTaskId?: string;
  openAfterCreate?: boolean;
  /** Nome exibido ("tarefa" ou "demanda"). */
  noun?: "tarefa" | "demanda";
  defaultAssigneeId?: string;
  defaultDueDate?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const { orgSlug, membershipId, permissions } = useWorkspace();
  const canAssign = permissions.includes("tasks.assign");
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (v: boolean) => {
    setOwnOpen(v);
    onOpenChange?.(v);
  };
  const clientsOf = [...new Map(projects.filter((p) => p.clientId).map((p) => [p.clientId!, p.clientName])).entries()];
  const [clientFilter, setClientFilter] = useState(
    () => projects.find((p) => p.id === defaultProjectId)?.clientId ?? "",
  );
  const visibleProjects = clientFilter ? projects.filter((p) => p.clientId === clientFilter) : projects;
  const Noun = noun === "demanda" ? "Demanda" : "Tarefa";
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const create = useOrgAction(createTaskAction, {
    success: parentTaskId ? "Subtarefa criada" : `${Noun} criada`,
    onSuccess: (data) => {
      setOpen(false);
      setCollaborators([]);
      if (openAfterCreate) router.push(`/w/${orgSlug}/tasks/${data.id}`);
    },
  });
  const fe = create.fieldErrors;
  const assignable = canAssign ? members : members.filter((m) => m.membershipId === membershipId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent size="lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const rawEstimate = String(f.get("estimate") ?? "").trim();
            const estimate = rawEstimate ? parseDuration(rawEstimate) : null;
            if (rawEstimate && estimate === null) {
              setEstimateError("Use 2h, 1h30, 45min ou 90");
              return;
            }
            setEstimateError(null);
            create.run({
              projectId: String(f.get("projectId") ?? ""),
              title: String(f.get("title") ?? ""),
              description: String(f.get("description") ?? ""),
              assigneeMembershipId: String(f.get("assignee") ?? ""),
              priority: String(f.get("priority") ?? "medium") as "medium",
              startDate: String(f.get("startDate") ?? ""),
              dueDate: String(f.get("dueDate") ?? ""),
              estimateMinutes: estimate,
              statusId: defaultStatusId ?? null,
              parentTaskId: parentTaskId ?? null,
              collaboratorIds: collaborators,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{parentTaskId ? "Nova subtarefa" : `Nova ${noun}`}</DialogTitle>
            <DialogDescription>
              Defina responsável, prazo e estimativa para organizar a carga da equipe.
              {openAfterCreate && !parentTaskId ? " Checklist, anexos e comentários ficam na página que abre ao criar." : null}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Título" htmlFor="t-title" required error={fe.title} className="sm:col-span-2">
              <Input id="t-title" name="title" required autoFocus placeholder="Ex.: Criar 3 posts para o feed" />
            </Field>
            {projects.length === 0 && !parentTaskId ? (
              <p className="rounded-lg bg-warning-soft p-3 text-sm sm:col-span-2">
                Toda {noun} pertence a um projeto de um cliente, e ainda não há projetos que você possa usar.{" "}
                <Link href={`/w/${orgSlug}/projects`} className="font-medium underline underline-offset-2">
                  Criar um projeto
                </Link>
              </p>
            ) : null}
            {clientsOf.length > 1 && !parentTaskId ? (
              <Field label="Cliente" htmlFor="t-client" hint="Filtra os projetos abaixo.">
                <NativeSelect id="t-client" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                  <option value="">Todos os clientes</option>
                  {clientsOf.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field
              label="Projeto"
              htmlFor="t-project"
              required
              error={fe.projectId}
              className={clientsOf.length > 1 && !parentTaskId ? undefined : "sm:col-span-2"}
            >
              <NativeSelect
                id="t-project"
                name="projectId"
                defaultValue={defaultProjectId ?? ""}
                disabled={!!parentTaskId}
                required
              >
                <option value="">Selecione…</option>
                {visibleProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName} · {p.name}
                  </option>
                ))}
              </NativeSelect>
              {parentTaskId ? <input type="hidden" name="projectId" value={defaultProjectId} /> : null}
            </Field>
            <Field label="Descrição" htmlFor="t-desc" className="sm:col-span-2">
              <Textarea id="t-desc" name="description" rows={3} />
            </Field>
            <Field
              label="Responsável"
              htmlFor="t-assignee"
              hint={canAssign ? undefined : "Você pode atribuir apenas a si mesmo."}
            >
              <NativeSelect id="t-assignee" name="assignee" defaultValue={defaultAssigneeId ?? membershipId}>
                <option value="">Sem responsável</option>
                {assignable.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prioridade" htmlFor="t-priority">
              <NativeSelect id="t-priority" name="priority" defaultValue="medium">
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Início" htmlFor="t-start">
              <Input id="t-start" name="startDate" type="date" />
            </Field>
            <Field label="Prazo" htmlFor="t-due" error={fe.dueDate}>
              <Input id="t-due" name="dueDate" type="date" defaultValue={defaultDueDate} />
            </Field>
            <Field
              label="Estimativa"
              htmlFor="t-estimate"
              hint="Ex.: 2h, 1h30, 45min"
              error={estimateError ?? fe.estimateMinutes}
            >
              <Input id="t-estimate" name="estimate" placeholder="1h30" />
            </Field>
            <Field label="Colaboradores">
              <div className="flex items-center gap-2">
                {collaborators.length ? (
                  <AvatarGroup people={members.filter((m) => collaborators.includes(m.membershipId))} max={4} />
                ) : null}
                <MemberPicker
                  members={members}
                  value={collaborators}
                  onChange={setCollaborators}
                  placeholder={collaborators.length ? "Editar" : "Adicionar"}
                />
              </div>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={create.pending}>
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
