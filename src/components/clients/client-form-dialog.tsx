"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
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
import { CLIENT_STATUS, CLIENT_STATUS_LABEL, clientInput } from "@/lib/validators/clients";
import { createClientAction, updateClientAction } from "@/server/actions/clients";

type FormValues = z.input<typeof clientInput>;

export function ClientFormDialog({
  trigger,
  client,
  members,
}: {
  trigger: React.ReactNode;
  client?: { id: string } & Partial<FormValues>;
  members: { membershipId: string; name: string }[];
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(clientInput) as never,
    defaultValues: {
      name: client?.name ?? "",
      legalName: client?.legalName ?? "",
      document: client?.document ?? "",
      email: client?.email ?? "",
      phone: client?.phone ?? "",
      website: client?.website ?? "",
      industry: client?.industry ?? "",
      address: client?.address ?? "",
      status: client?.status ?? "active",
      notesInternal: client?.notesInternal ?? "",
      leadMembershipId: client?.leadMembershipId ?? "",
    },
  });
  const create = useOrgAction(createClientAction, {
    success: "Cliente cadastrado",
    onSuccess: (data) => {
      setOpen(false);
      form.reset();
      router.push(`/w/${orgSlug}/clients/${data.id}`);
    },
  });
  const update = useOrgAction(updateClientAction, {
    success: "Cliente atualizado",
    onSuccess: () => setOpen(false),
  });
  const pending = create.pending || update.pending;
  const errors = { ...form.formState.errors };
  const serverErrors = client ? update.fieldErrors : create.fieldErrors;
  const err = (k: keyof FormValues) => (errors[k]?.message as string | undefined) ?? serverErrors[k as string]?.[0] ?? serverErrors[`data.${String(k)}`]?.[0];

  const submit = form.handleSubmit(() => {
    const values = form.getValues();
    if (client) update.run({ id: client.id, data: values });
    else create.run(values);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
          <DialogHeader>
            <DialogTitle>{client ? "Editar cliente" : "Novo cliente"}</DialogTitle>
            <DialogDescription>Dados cadastrais e responsável interno pelo atendimento.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="c-name" required error={err("name")} className="sm:col-span-2">
              <Input id="c-name" autoFocus {...form.register("name")} aria-invalid={!!err("name")} />
            </Field>
            <Field label="Razão social" htmlFor="c-legal">
              <Input id="c-legal" {...form.register("legalName")} />
            </Field>
            <Field label="CNPJ / CPF" htmlFor="c-doc">
              <Input id="c-doc" inputMode="numeric" {...form.register("document")} />
            </Field>
            <Field label="E-mail" htmlFor="c-email" error={err("email")}>
              <Input id="c-email" type="email" {...form.register("email")} aria-invalid={!!err("email")} />
            </Field>
            <Field label="Telefone" htmlFor="c-phone">
              <Input id="c-phone" type="tel" {...form.register("phone")} />
            </Field>
            <Field label="Site" htmlFor="c-site">
              <Input id="c-site" placeholder="https://" {...form.register("website")} />
            </Field>
            <Field label="Segmento" htmlFor="c-industry">
              <Input id="c-industry" placeholder="Ex.: Varejo, Saúde, Educação" {...form.register("industry")} />
            </Field>
            <Field label="Status" htmlFor="c-status">
              <NativeSelect id="c-status" {...form.register("status")}>
                {CLIENT_STATUS.map((st) => (
                  <option key={st} value={st}>
                    {CLIENT_STATUS_LABEL[st]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Responsável pelo atendimento" htmlFor="c-lead">
              <NativeSelect id="c-lead" {...form.register("leadMembershipId")}>
                <option value="">{client ? "Manter atual" : "Eu mesmo"}</option>
                {members.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Endereço" htmlFor="c-address" className="sm:col-span-2">
              <Input id="c-address" {...form.register("address")} />
            </Field>
            <Field label="Observações internas" htmlFor="c-notes" hint="Nunca são exibidas ao cliente." className="sm:col-span-2">
              <Textarea id="c-notes" rows={3} {...form.register("notesInternal")} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {client ? "Salvar" : "Cadastrar cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
