"use client";

import { Ban, Building2, MoreHorizontal, Pencil, RotateCcw, UserX } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { formatMinutes, formatMoney } from "@/lib/format";
import { setMemberStatusAction } from "@/server/actions/team";
import type { RoleOption } from "./invite-dialog";
import { ClientAccessDialog, MemberEditDialog, type MemberData } from "./member-dialogs";

export type MemberTableRow = MemberData & {
  userId: string;
  image: string | null;
  roleName: string;
  status: "active" | "suspended" | "removed";
  openTasks: number;
  overdueTasks: number;
};

export function MembersTable({
  members,
  roles,
  clients,
  canManage,
  canSeeCost,
  isOwner,
}: {
  members: MemberTableRow[];
  roles: RoleOption[];
  clients: { id: string; name: string }[];
  canManage: boolean;
  canSeeCost: boolean;
  isOwner: boolean;
}) {
  const { membershipId: me } = useWorkspace();
  const [editing, setEditing] = useState<MemberTableRow | null>(null);
  const [access, setAccess] = useState<MemberTableRow | null>(null);
  const status = useOrgAction(setMemberStatusAction, { success: "Acesso atualizado" });

  const internal = members.filter((m) => m.kind === "internal");
  const clientUsers = members.filter((m) => m.kind === "client");

  const table = (rows: MemberTableRow[], kind: "internal" | "client") => (
    <Table>
      <THead>
        <tr>
          <TH>Pessoa</TH>
          <TH>Papel</TH>
          {kind === "internal" ? (
            <>
              <TH className="hidden lg:table-cell">Especialidades</TH>
              <TH className="hidden text-right md:table-cell">Capacidade</TH>
              {canSeeCost ? <TH className="hidden text-right xl:table-cell">Custo/hora</TH> : null}
              <TH className="hidden text-right sm:table-cell">Tarefas abertas</TH>
            </>
          ) : (
            <TH className="hidden md:table-cell">Clientes</TH>
          )}
          <TH className="w-12" aria-label="Ações" />
        </tr>
      </THead>
      <TBody>
        {rows.map((m) => {
          const self = m.membershipId === me;
          const ownerTarget = m.roleKey === "owner";
          const canAct = canManage && !self && (!ownerTarget || isOwner);
          return (
            <TR key={m.membershipId}>
              <TD>
                <div className="flex items-center gap-3">
                  <Avatar name={m.name} src={m.image} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {m.name}
                      {self ? <span className="text-xs font-normal text-fg-subtle">(você)</span> : null}
                      {m.status === "suspended" ? <Badge tone="warning">Suspenso</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                      {m.jobTitle ? `${m.jobTitle} · ${m.email}` : m.email}
                    </p>
                  </div>
                </div>
              </TD>
              <TD>
                <Badge tone={ownerTarget ? "accent" : "neutral"}>{m.roleName}</Badge>
              </TD>
              {kind === "internal" ? (
                <>
                  <TD className="hidden max-w-56 lg:table-cell">
                    {m.specialties.length ? (
                      <div className="flex flex-wrap gap-1">
                        {m.specialties.slice(0, 3).map((sp) => (
                          <Badge key={sp} tone="outline">
                            {sp}
                          </Badge>
                        ))}
                        {m.specialties.length > 3 ? (
                          <span className="text-xs text-fg-subtle">+{m.specialties.length - 3}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-fg-subtle">—</span>
                    )}
                  </TD>
                  <TD className="tabular hidden text-right md:table-cell">
                    {formatMinutes(m.weeklyCapacityMinutes)}/sem
                  </TD>
                  {canSeeCost ? (
                    <TD className="tabular hidden text-right xl:table-cell">
                      {m.hourlyCostCents != null ? formatMoney(m.hourlyCostCents) : "—"}
                    </TD>
                  ) : null}
                  <TD className="tabular hidden text-right sm:table-cell">
                    {m.openTasks}
                    {m.overdueTasks ? (
                      <span className="ml-1 text-xs text-danger">
                        ({m.overdueTasks} atrasada{m.overdueTasks > 1 ? "s" : ""})
                      </span>
                    ) : null}
                  </TD>
                </>
              ) : (
                <TD className="hidden md:table-cell">
                  <span className="text-sm text-fg-muted">{m.clients.map((c) => c.name).join(", ") || "—"}</span>
                </TD>
              )}
              <TD>
                {canAct || self ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${m.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(m)}>
                        <Pencil /> Editar
                      </DropdownMenuItem>
                      {canAct && m.kind === "client" ? (
                        <DropdownMenuItem onSelect={() => setAccess(m)}>
                          <Building2 /> Clientes com acesso
                        </DropdownMenuItem>
                      ) : null}
                      {canAct ? (
                        <>
                          <DropdownMenuSeparator />
                          {m.status === "suspended" ? (
                            <DropdownMenuItem
                              onSelect={() => status.run({ membershipId: m.membershipId, status: "active" })}
                            >
                              <RotateCcw /> Reativar acesso
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => status.run({ membershipId: m.membershipId, status: "suspended" })}
                            >
                              <Ban /> Suspender acesso
                            </DropdownMenuItem>
                          )}
                          <ConfirmDialog
                            title={`Remover ${m.name}?`}
                            description="O acesso é revogado imediatamente. Tarefas, comentários e histórico desta pessoa são preservados."
                            confirmLabel="Remover"
                            onConfirm={() => status.run({ membershipId: m.membershipId, status: "removed" })}
                            trigger={
                              <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                                <UserX /> Remover da organização
                              </DropdownMenuItem>
                            }
                          />
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Card>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold">Equipe da agência</h2>
          <span className="text-xs text-fg-subtle">{internal.length} pessoa(s)</span>
        </div>
        {table(internal, "internal")}
      </Card>
      {clientUsers.length ? (
        <Card>
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-sm font-semibold">Usuários de clientes</h2>
            <span className="text-xs text-fg-subtle">{clientUsers.length} pessoa(s)</span>
          </div>
          {table(clientUsers, "client")}
        </Card>
      ) : null}
      {editing ? (
        <MemberEditDialog
          member={editing}
          roles={roles}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          canManage={canManage && editing.membershipId !== me && (editing.roleKey !== "owner" || isOwner)}
          canEditCost={canManage && canSeeCost}
          canGrantOwner={isOwner}
        />
      ) : null}
      {access ? (
        <ClientAccessDialog member={access} clients={clients} open onOpenChange={(o) => !o && setAccess(null)} />
      ) : null}
    </div>
  );
}
