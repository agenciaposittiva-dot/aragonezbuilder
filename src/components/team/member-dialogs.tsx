"use client";

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
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { setClientAccessAction, updateMemberAction } from "@/server/actions/team";
import type { RoleOption } from "./invite-dialog";

export type MemberData = {
  membershipId: string;
  name: string;
  email: string;
  roleId: string;
  roleKey: string;
  kind: "internal" | "client";
  jobTitle: string | null;
  specialties: string[];
  weeklyCapacityMinutes: number;
  hourlyCostCents: number | null;
  clients: { id: string; name: string }[];
};

export function MemberEditDialog({
  member,
  roles,
  open,
  onOpenChange,
  canManage,
  canEditCost,
  canGrantOwner,
}: {
  member: MemberData;
  roles: RoleOption[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canManage: boolean;
  canEditCost: boolean;
  canGrantOwner: boolean;
}) {
  const update = useOrgAction(updateMemberAction, {
    success: "Membro atualizado",
    onSuccess: () => onOpenChange(false),
  });
  const sameKind = roles.filter(
    (r) => r.kind === member.kind && (r.key !== "owner" || canGrantOwner || member.roleKey === "owner"),
  );
  const ownerLocked = member.roleKey === "owner" && !canGrantOwner;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const specialties = String(f.get("specialties") ?? "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            update.run({
              membershipId: member.membershipId,
              jobTitle: String(f.get("jobTitle") ?? ""),
              specialties,
              ...(canManage
                ? { roleId: String(f.get("roleId")), weeklyCapacityHours: Number(f.get("capacity") ?? 0) }
                : {}),
              ...(canEditCost ? { hourlyCost: String(f.get("hourlyCost") ?? "") } : {}),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{member.name}</DialogTitle>
            <DialogDescription>{member.email}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            {canManage ? (
              <Field
                label="Papel"
                htmlFor="m-role"
                className="sm:col-span-2"
                hint={ownerLocked ? "Só um proprietário altera o papel de outro proprietário." : undefined}
              >
                <NativeSelect id="m-role" name="roleId" defaultValue={member.roleId} disabled={ownerLocked}>
                  {sameKind.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
                {ownerLocked ? <input type="hidden" name="roleId" value={member.roleId} /> : null}
              </Field>
            ) : null}
            {member.kind === "internal" ? (
              <>
                <Field label="Cargo" htmlFor="m-title">
                  <Input
                    id="m-title"
                    name="jobTitle"
                    defaultValue={member.jobTitle ?? ""}
                    placeholder="Ex.: Designer sênior"
                  />
                </Field>
                {canManage ? (
                  <Field label="Capacidade semanal (horas)" htmlFor="m-cap">
                    <Input
                      id="m-cap"
                      name="capacity"
                      type="number"
                      min={0}
                      max={80}
                      step={1}
                      defaultValue={Math.round(member.weeklyCapacityMinutes / 60)}
                    />
                  </Field>
                ) : null}
                <Field label="Especialidades" htmlFor="m-spec" hint="Separe por vírgulas." className="sm:col-span-2">
                  <Input
                    id="m-spec"
                    name="specialties"
                    defaultValue={member.specialties.join(", ")}
                    placeholder="Motion, Branding, Social"
                  />
                </Field>
                {canEditCost ? (
                  <Field
                    label="Custo interno por hora (R$)"
                    htmlFor="m-cost"
                    hint="Usado no cálculo de rentabilidade. Nunca exibido ao cliente."
                    error={update.fieldErrors.hourlyCost}
                  >
                    <Input
                      id="m-cost"
                      name="hourlyCost"
                      inputMode="decimal"
                      placeholder="0,00"
                      defaultValue={
                        member.hourlyCostCents != null
                          ? (member.hourlyCostCents / 100).toFixed(2).replace(".", ",")
                          : ""
                      }
                    />
                  </Field>
                ) : null}
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
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

export function ClientAccessDialog({
  member,
  clients,
  open,
  onOpenChange,
}: {
  member: MemberData;
  clients: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [ids, setIds] = useState(member.clients.map((c) => c.id));
  const save = useOrgAction(setClientAccessAction, {
    success: "Acesso atualizado",
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Clientes de {member.name}</DialogTitle>
          <DialogDescription>
            Esta pessoa verá apenas os registros e materiais compartilhados destes clientes.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="max-h-64 scrollbar-thin overflow-y-auto rounded-md border border-border p-1">
            {clients.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-2">
                  <Checkbox
                    checked={ids.includes(c.id)}
                    onCheckedChange={(v) =>
                      setIds((cur) => (v === true ? [...cur, c.id] : cur.filter((x) => x !== c.id)))
                    }
                  />
                  {c.name}
                </label>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            disabled={!ids.length}
            onClick={() => save.run({ membershipId: member.membershipId, clientIds: ids })}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
