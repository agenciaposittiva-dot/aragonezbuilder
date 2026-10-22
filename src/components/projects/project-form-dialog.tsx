"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { MemberPicker, type MemberLite } from "@/components/app/member-picker";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { AvatarGroup } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DEFAULT_STAGES, projectInput } from "@/lib/validators/projects";
import { createProjectAction } from "@/server/actions/projects";

type FormValues = z.input<typeof projectInput>;

export function ProjectFormDialog({
  trigger,
  clients,
  members,
  defaultClientId,
  canSetBudget,
  defaultOpen = false,
}: {
  trigger: React.ReactNode;
  clients: { id: string; name: string }[];
  members: MemberLite[];
  defaultClientId?: string;
  canSetBudget: boolean;
  /** Abre ao carregar (atalho "Criar projeto": ?novo=1). */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { orgSlug, membershipId } = useWorkspace();
  const [open, setOpen] = useState(defaultOpen);
  const [withStages, setWithStages] = useState(true);
  const form = useForm<FormValues>({
    resolver: zodResolver(projectInput) as never,
    defaultValues: {
      clientId: defaultClientId ?? "",
      name: "",
      description: "",
      objective: "",
      ownerMembershipId: membershipId,
      priority: "medium",
      startDate: "",
      dueDate: "",
      budget: "",
      memberIds: [],
    },
  });
  const create = useOrgAction(createProjectAction, {
    success: "Projeto criado",
    onSuccess: (data) => {
      setOpen(false);
      form.reset();
      router.push(`/w/${orgSlug}/projects/${data.id}`);
    },
  });
  const e = form.formState.errors;
  const err = (k: keyof FormValues) => (e[k]?.message as string | undefined) ?? create.fieldErrors[k as string]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <form
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={form.handleSubmit(() =>
            create.run({ ...form.getValues(), stages: withStages ? DEFAULT_STAGES : [] }),
          )}
        >
          <DialogHeader>
            <DialogTitle>Novo projeto</DialogTitle>
            <DialogDescription>
              Defina cliente, responsável, prazos e equipe. As tarefas vêm em seguida.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Cliente" htmlFor="p-client" required error={err("clientId")}>
              <NativeSelect id="p-client" {...form.register("clientId")} aria-invalid={!!err("clientId")}>
                <option value="">Selecione…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Nome do projeto" htmlFor="p-name" required error={err("name")}>
              <Input
                id="p-name"
                {...form.register("name")}
                placeholder="Ex.: Campanha Black Friday"
                aria-invalid={!!err("name")}
              />
            </Field>
            <Field label="Objetivo" htmlFor="p-obj" className="sm:col-span-2">
              <Input id="p-obj" {...form.register("objective")} placeholder="O resultado esperado, em uma frase" />
            </Field>
            <Field label="Descrição" htmlFor="p-desc" className="sm:col-span-2">
              <Textarea id="p-desc" rows={3} {...form.register("description")} />
            </Field>
            <Field label="Responsável" htmlFor="p-owner">
              <NativeSelect id="p-owner" {...form.register("ownerMembershipId")}>
                {members.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prioridade" htmlFor="p-priority">
              <NativeSelect id="p-priority" {...form.register("priority")}>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Início" htmlFor="p-start">
              <Input id="p-start" type="date" {...form.register("startDate")} />
            </Field>
            <Field label="Prazo" htmlFor="p-due" error={err("dueDate")}>
              <Input id="p-due" type="date" {...form.register("dueDate")} />
            </Field>
            {canSetBudget ? (
              <Field
                label="Orçamento (R$)"
                htmlFor="p-budget"
                hint="Visível apenas para quem acessa o financeiro."
                error={err("budget")}
              >
                <Input id="p-budget" inputMode="decimal" placeholder="0,00" {...form.register("budget")} />
              </Field>
            ) : null}
            <Field label="Equipe" className={canSetBudget ? "" : "sm:col-span-2"}>
              <Controller
                control={form.control}
                name="memberIds"
                render={({ field }) => {
                  const selected = members.filter((m) => (field.value ?? []).includes(m.membershipId));
                  return (
                    <div className="flex items-center gap-2">
                      {selected.length ? <AvatarGroup people={selected} max={5} /> : null}
                      <MemberPicker
                        members={members}
                        value={field.value ?? []}
                        onChange={field.onChange}
                        placeholder={selected.length ? "Editar" : "Adicionar pessoas"}
                      />
                    </div>
                  );
                }}
              />
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <Checkbox checked={withStages} onCheckedChange={(v) => setWithStages(v === true)} className="mt-0.5" />
              <span>
                Criar etapas padrão
                <span className="block text-xs text-fg-muted">{DEFAULT_STAGES.join(" → ")}</span>
              </span>
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={create.pending}>
              Criar projeto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
