"use client";

import { Lock, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { INTERNAL_ONLY, PERMISSION_GROUPS, PERMISSIONS, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { deleteRoleAction, resetRoleAction, saveRoleAction } from "@/server/actions/settings";

type Role = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: "internal" | "client";
  permissions: string[];
  isSystem: boolean;
  members: number | null;
};

export function RolesEditor({ roles, currentRoleId }: { roles: Role[]; currentRoleId: string }) {
  const [selectedId, setSelectedId] = useState(roles.find((r) => r.key !== "owner")?.id ?? roles[0]?.id);
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0]!;
  const [perms, setPerms] = useState<Set<string>>(new Set(selected.permissions));
  const [dirty, setDirty] = useState(false);
  const save = useOrgAction(saveRoleAction, { success: "Permissões salvas", onSuccess: () => setDirty(false) });
  const reset = useOrgAction(resetRoleAction, { success: "Permissões padrão restauradas" });
  const remove = useOrgAction(deleteRoleAction, { success: "Papel excluído" });
  const locked = selected.key === "owner";

  function select(role: Role) {
    setSelectedId(role.id);
    setPerms(new Set(role.permissions));
    setDirty(false);
  }

  const groups = useMemo(
    () =>
      PERMISSION_GROUPS.map((g) => ({
        ...g,
        permissions: g.permissions.filter((p) =>
          selected.kind === "client"
            ? !INTERNAL_ONLY.includes(p)
            : p !== "portal.access" && p !== "approvals.decide_client",
        ),
      })).filter((g) => g.permissions.length),
    [selected.kind],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-fg-subtle uppercase">Papéis</p>
          <NewRoleDialog roles={roles} />
        </div>
        <ul className="grid gap-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => select(r)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                  r.id === selected.id ? "border-accent bg-accent-soft/50" : "border-transparent hover:bg-surface-2",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {r.name}
                    {r.key === "owner" ? <Lock className="size-3 text-fg-subtle" /> : null}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {r.kind === "client" ? "Cliente" : "Equipe"} · {r.isSystem ? "padrão" : "personalizado"}
                  </span>
                </span>
                <span className="tabular flex items-center gap-1 text-xs text-fg-subtle">
                  <Users className="size-3" />
                  {r.members ?? 0}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Card className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{selected.name}</h2>
            <p className="text-sm text-fg-muted">{selected.description ?? "Sem descrição"}</p>
            {selected.id === currentRoleId ? (
              <Badge tone="accent" className="mt-2">
                Seu papel
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.isSystem && !locked ? (
              <Button variant="ghost" size="sm" onClick={() => reset.run({ id: selected.id })} loading={reset.pending}>
                <RotateCcw /> Restaurar padrão
              </Button>
            ) : null}
            {!selected.isSystem ? (
              <ConfirmDialog
                title={`Excluir "${selected.name}"?`}
                description="Só é possível excluir papéis sem pessoas vinculadas."
                confirmLabel="Excluir"
                onConfirm={() => remove.run({ id: selected.id })}
                trigger={
                  <Button variant="danger-ghost" size="sm">
                    <Trash2 /> Excluir
                  </Button>
                }
              />
            ) : null}
            {!locked ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!dirty}
                loading={save.pending}
                onClick={() =>
                  save.run({
                    id: selected.id,
                    name: selected.name,
                    description: selected.description ?? undefined,
                    kind: selected.kind,
                    permissions: [...perms],
                  })
                }
              >
                Salvar permissões
              </Button>
            ) : null}
          </div>
        </div>
        {locked ? (
          <p className="flex items-center gap-2 border-b border-border bg-surface-2/50 px-5 py-3 text-sm text-fg-muted">
            <Lock className="size-4" /> O Proprietário sempre tem acesso total, para que a organização nunca perca o
            controle.
          </p>
        ) : null}
        <div className="grid gap-6 p-5 sm:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g.label} className="grid content-start gap-2">
              <legend className="mb-1 text-xs font-semibold text-fg-subtle uppercase">{g.label}</legend>
              {g.permissions.map((p: Permission) => (
                <label key={p} className={cn("flex items-start gap-2.5 text-sm", locked && "opacity-70")}>
                  <Checkbox
                    className="mt-0.5"
                    checked={locked || perms.has(p)}
                    disabled={locked}
                    onCheckedChange={(v) => {
                      const next = new Set(perms);
                      if (v) next.add(p);
                      else next.delete(p);
                      setPerms(next);
                      setDirty(true);
                    }}
                  />
                  <span>
                    <span className="block text-fg">{PERMISSIONS[p]}</span>
                    <code className="text-[11px] text-fg-subtle">{p}</code>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </Card>
    </div>
  );
}

function NewRoleDialog({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"internal" | "client">("internal");
  const save = useOrgAction(saveRoleAction, { success: "Papel criado", onSuccess: () => setOpen(false) });
  const bases = roles.filter((r) => r.kind === kind && r.key !== "owner");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs">
          <Plus /> Novo papel
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const base = roles.find((r) => r.id === f.get("base"));
            save.run({
              name: String(f.get("name") ?? ""),
              description: String(f.get("description") ?? ""),
              kind,
              permissions: base?.permissions ?? [],
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Novo papel</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Nome" htmlFor="r-name" required error={save.fieldErrors.name}>
              <Input id="r-name" name="name" placeholder="Ex.: Freelancer de vídeo" required autoFocus />
            </Field>
            <Field label="Descrição" htmlFor="r-desc">
              <Input id="r-desc" name="description" />
            </Field>
            <Field label="Tipo" htmlFor="r-kind">
              <NativeSelect id="r-kind" value={kind} onChange={(e) => setKind(e.target.value as "internal" | "client")}>
                <option value="internal">Equipe da agência</option>
                <option value="client">Usuário de cliente</option>
              </NativeSelect>
            </Field>
            <Field label="Copiar permissões de" htmlFor="r-base">
              <NativeSelect id="r-base" name="base">
                <option value="">Nenhuma (começar vazio)</option>
                {bases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={save.pending}>
              Criar papel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
