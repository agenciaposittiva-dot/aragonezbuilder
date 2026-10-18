"use client";

import { Mail, Pencil, Phone, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { deleteContactAction, saveContactAction } from "@/server/actions/clients";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
  notes: string | null;
};

export function ClientContacts({
  clientId,
  contacts,
  canWrite,
}: {
  clientId: string;
  contacts: Contact[];
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const save = useOrgAction(saveContactAction, { success: "Contato salvo", onSuccess: () => setEditing(null) });
  const remove = useOrgAction(deleteContactAction, { success: "Contato removido" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contatos</CardTitle>
        {canWrite ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Adicionar contato"
            onClick={() => setEditing({ isPrimary: contacts.length === 0 })}
          >
            <Plus />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhum contato cadastrado.</p>
        ) : (
          <ul className="grid divide-y divide-border">
            {contacts.map((c) => (
              <li key={c.id} className="group flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {c.name}
                    {c.isPrimary ? (
                      <Star className="size-3.5 fill-accent text-accent" aria-label="Contato principal" />
                    ) : null}
                  </p>
                  {c.position ? <p className="truncate text-xs text-fg-muted">{c.position}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-fg">
                        <Mail className="size-3" /> {c.email}
                      </a>
                    ) : null}
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-fg">
                        <Phone className="size-3" /> {c.phone}
                      </a>
                    ) : null}
                  </div>
                </div>
                {canWrite ? (
                  <div className="flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Editar ${c.name}`}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil />
                    </Button>
                    <ConfirmDialog
                      title="Remover contato?"
                      description={`${c.name} será removido deste cliente.`}
                      confirmLabel="Remover"
                      onConfirm={() => remove.run({ clientId, contactId: c.id })}
                      trigger={
                        <Button variant="ghost" size="icon-xs" aria-label={`Remover ${c.name}`}>
                          <Trash2 />
                        </Button>
                      }
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="md">
          {editing ? (
            <form
              className="flex min-h-0 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save.run({
                  id: editing.id ?? null,
                  clientId,
                  name: String(f.get("name") ?? ""),
                  email: String(f.get("email") ?? ""),
                  phone: String(f.get("phone") ?? ""),
                  position: String(f.get("position") ?? ""),
                  notes: String(f.get("notes") ?? ""),
                  isPrimary: f.get("isPrimary") === "on",
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>{editing.id ? "Editar contato" : "Novo contato"}</DialogTitle>
              </DialogHeader>
              <DialogBody className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome" htmlFor="ct-name" required error={save.fieldErrors.name} className="sm:col-span-2">
                  <Input id="ct-name" name="name" defaultValue={editing.name ?? ""} required autoFocus />
                </Field>
                <Field label="Cargo" htmlFor="ct-position">
                  <Input id="ct-position" name="position" defaultValue={editing.position ?? ""} />
                </Field>
                <Field label="Telefone" htmlFor="ct-phone">
                  <Input id="ct-phone" name="phone" type="tel" defaultValue={editing.phone ?? ""} />
                </Field>
                <Field label="E-mail" htmlFor="ct-email" error={save.fieldErrors.email} className="sm:col-span-2">
                  <Input id="ct-email" name="email" type="email" defaultValue={editing.email ?? ""} />
                </Field>
                <Field label="Observações" htmlFor="ct-notes" className="sm:col-span-2">
                  <Textarea id="ct-notes" name="notes" rows={2} defaultValue={editing.notes ?? ""} />
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Checkbox name="isPrimary" defaultChecked={editing.isPrimary ?? false} />
                  Contato principal
                </label>
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
