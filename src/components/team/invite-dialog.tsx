"use client";

import { Check, Copy, UserPlus } from "lucide-react";
import { useState } from "react";
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
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { createInvitationAction } from "@/server/actions/team";

export type RoleOption = {
  id: string;
  key: string;
  name: string;
  kind: "internal" | "client";
  description: string | null;
};

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate text-xs text-fg-muted">{url}</code>
      <Button
        type="button"
        size="xs"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

export function InviteDialog({
  roles,
  clients,
  canInviteOwner,
}: {
  roles: RoleOption[];
  clients: { id: string; name: string }[];
  canInviteOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const create = useOrgAction(createInvitationAction, {
    success: "Convite enviado",
    onSuccess: (d) => setLink(d.url),
  });
  const role = roles.find((r) => r.id === roleId);
  const internalRoles = roles.filter((r) => r.kind === "internal" && (r.key !== "owner" || canInviteOwner));
  const clientRoles = roles.filter((r) => r.kind === "client");

  function reset() {
    setRoleId("");
    setClientIds([]);
    setLink(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <UserPlus /> Convidar
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>Convite enviado</DialogTitle>
              <DialogDescription>
                Enviamos o link por e-mail. Você também pode copiá-lo e enviar por outro canal. Ele vale por 7 dias.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <CopyLink url={link} />
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={reset}>
                Convidar outra pessoa
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Concluir
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              create.run({
                email: String(f.get("email") ?? ""),
                roleId,
                clientIds: role?.kind === "client" ? clientIds : [],
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Convidar pessoa</DialogTitle>
              <DialogDescription>
                Membros da equipe acessam o painel; usuários de cliente acessam só a área do cliente.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <Field label="E-mail" htmlFor="inv-email" required error={create.fieldErrors.email}>
                <Input id="inv-email" name="email" type="email" required autoFocus placeholder="nome@empresa.com.br" />
              </Field>
              <Field
                label="Papel"
                htmlFor="inv-role"
                required
                error={create.fieldErrors.roleId}
                hint={role?.description ?? undefined}
              >
                <NativeSelect id="inv-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                  <option value="">Selecione…</option>
                  <optgroup label="Equipe da agência">
                    {internalRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Cliente">
                    {clientRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                </NativeSelect>
              </Field>
              {role?.kind === "client" ? (
                <Field label="Clientes que poderá acessar" required error={create.fieldErrors.clientIds}>
                  {clients.length === 0 ? (
                    <p className="text-sm text-fg-muted">Cadastre um cliente antes de convidar usuários de cliente.</p>
                  ) : (
                    <ul className="max-h-48 scrollbar-thin overflow-y-auto rounded-md border border-border p-1">
                      {clients.map((c) => (
                        <li key={c.id}>
                          <label className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-2">
                            <Checkbox
                              checked={clientIds.includes(c.id)}
                              onCheckedChange={(v) =>
                                setClientIds((ids) => (v === true ? [...ids, c.id] : ids.filter((x) => x !== c.id)))
                              }
                            />
                            {c.name}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </Field>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={create.pending}
                disabled={!roleId || (role?.kind === "client" && !clientIds.length)}
              >
                Enviar convite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
