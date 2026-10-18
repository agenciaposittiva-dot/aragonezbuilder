"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { updateProjectAction } from "@/server/actions/projects";

type Project = {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  ownerMembershipId: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  startDate: string | null;
  dueDate: string | null;
  budgetCents: number | null;
};

export function ProjectEditDialog({
  project,
  members,
  canSetBudget,
}: {
  project: Project;
  members: { membershipId: string; name: string }[];
  canSetBudget: boolean;
}) {
  const [open, setOpen] = useState(false);
  const update = useOrgAction(updateProjectAction, { success: "Projeto atualizado", onSuccess: () => setOpen(false) });
  const fe = update.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Pencil /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            update.run({
              id: project.id,
              name: String(f.get("name") ?? ""),
              description: String(f.get("description") ?? ""),
              objective: String(f.get("objective") ?? ""),
              ownerMembershipId: String(f.get("ownerMembershipId") ?? ""),
              priority: String(f.get("priority")) as Project["priority"],
              startDate: String(f.get("startDate") ?? ""),
              dueDate: String(f.get("dueDate") ?? ""),
              ...(canSetBudget ? { budget: String(f.get("budget") ?? "") } : {}),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Editar projeto</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="pe-name" required error={fe.name} className="sm:col-span-2">
              <Input id="pe-name" name="name" defaultValue={project.name} required />
            </Field>
            <Field label="Objetivo" htmlFor="pe-obj" className="sm:col-span-2">
              <Input id="pe-obj" name="objective" defaultValue={project.objective ?? ""} />
            </Field>
            <Field label="Descrição" htmlFor="pe-desc" className="sm:col-span-2">
              <Textarea id="pe-desc" name="description" rows={4} defaultValue={project.description ?? ""} />
            </Field>
            <Field label="Responsável" htmlFor="pe-owner">
              <NativeSelect id="pe-owner" name="ownerMembershipId" defaultValue={project.ownerMembershipId ?? ""}>
                <option value="">Sem responsável</option>
                {members.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prioridade" htmlFor="pe-priority">
              <NativeSelect id="pe-priority" name="priority" defaultValue={project.priority}>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Início" htmlFor="pe-start">
              <Input id="pe-start" name="startDate" type="date" defaultValue={project.startDate ?? ""} />
            </Field>
            <Field label="Prazo" htmlFor="pe-due" error={fe.dueDate}>
              <Input id="pe-due" name="dueDate" type="date" defaultValue={project.dueDate ?? ""} />
            </Field>
            {canSetBudget ? (
              <Field label="Orçamento (R$)" htmlFor="pe-budget" error={fe.budget}>
                <Input
                  id="pe-budget"
                  name="budget"
                  inputMode="decimal"
                  defaultValue={
                    project.budgetCents != null ? (project.budgetCents / 100).toFixed(2).replace(".", ",") : ""
                  }
                />
              </Field>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={update.pending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
