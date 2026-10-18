"use client";

import { Mail, RefreshCw, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { InviteExtraFields } from "@/components/team/invite-dialog";
import { EmailStateBadge, InviteResult } from "@/components/team/invite-result";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate, formatDateTime } from "@/lib/format";
import { INVITE_VALIDITY } from "@/lib/validators/team";
import {
  changeGuestRoleAction,
  inviteGuestAction,
  removeGuestAccessAction,
  resendGuestInvitationAction,
  revokeGuestInvitationAction,
} from "@/server/actions/guests";
import type { EmailDeliveryState } from "@/server/mail";
import type { ClientGuests } from "@/server/services/guests";

type Role = { id: string; key: string; name: string; description: string | null };

const INVITE_STATUS = {
  pending: { label: "Pendente", tone: "info" },
  accepted: { label: "Aceito", tone: "success" },
  revoked: { label: "Revogado", tone: "neutral" },
  expired: { label: "Expirado", tone: "danger" },
} as const;

/**
 * Convidados de um cliente: pessoas com acesso ao portal e convites. Usado na
 * área interna (equipe da agência) e no portal (administrador do cliente, que
 * só convida e cancela convites deste cliente). O servidor confere tudo.
 */
export function GuestsManager({
  clientId,
  data,
  roles,
  canManage,
}: {
  clientId: string;
  data: ClientGuests;
  roles: Role[];
  canManage: boolean;
}) {
  const internal = data.mode === "internal";
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [result, setResult] = useState<
    { kind: "invite"; url: string; email: EmailDeliveryState; days: number } | { kind: "granted" } | null
  >(null);
  const [days, setDays] = useState<number>(INVITE_VALIDITY.default);
  const invite = useOrgAction(inviteGuestAction, {
    success: (d) => ("granted" in d ? "Acesso incluído" : "Convite criado"),
    onSuccess: (d) =>
      setResult("granted" in d ? { kind: "granted" } : { kind: "invite", url: d.url, email: d.email, days }),
  });
  const [resent, setResent] = useState<{ url: string; email: EmailDeliveryState } | null>(null);
  const resend = useOrgAction(resendGuestInvitationAction, {
    success: "Novo link gerado",
    onSuccess: (d) => setResent({ url: d.url, email: d.email }),
  });
  const revoke = useOrgAction(revokeGuestInvitationAction, { success: "Convite revogado" });
  const changeRole = useOrgAction(changeGuestRoleAction, { success: "Papel atualizado" });
  const remove = useOrgAction(removeGuestAccessAction, { success: "Acesso removido" });
  const role = roles.find((r) => r.id === roleId);

  function closeInvite(open: boolean) {
    setInviteOpen(open);
    if (!open) {
      setResult(null);
      setRoleId("");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Pessoas com acesso</CardTitle>
            <CardDescription>
              {internal
                ? "Convidados entram pelo portal deste cliente e veem só o que for compartilhado com ele."
                : "Colegas da sua empresa com acesso a este portal."}
            </CardDescription>
          </div>
          {canManage ? (
            <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus /> Convidar
            </Button>
          ) : null}
        </CardHeader>
        {data.members.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title="Ninguém com acesso ainda"
            description="Convide as pessoas do cliente que vão aprovar materiais e abrir demandas."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Pessoa</TH>
                <TH>Papel</TH>
                <TH className="hidden md:table-cell">Último acesso</TH>
                <TH className="hidden lg:table-cell">Entrou em</TH>
                {internal && canManage ? <TH className="w-12" /> : null}
              </tr>
            </THead>
            <TBody>
              {data.members.map((m) => (
                <TR key={m.membershipId}>
                  <TD>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={m.name} src={m.image} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {m.name}
                          {m.isSelf ? <span className="text-fg-subtle"> (você)</span> : null}
                        </span>
                        <span className="block truncate text-xs text-fg-muted">{m.email}</span>
                      </span>
                      {m.status === "suspended" ? <Badge tone="warning">Suspenso</Badge> : null}
                    </span>
                  </TD>
                  <TD>
                    {internal && canManage ? (
                      <NativeSelect
                        aria-label={`Papel de ${m.name}`}
                        value={m.roleId}
                        disabled={changeRole.pending}
                        onChange={(e) =>
                          changeRole.run({ clientId, membershipId: m.membershipId, roleId: e.target.value })
                        }
                        className="h-8 min-w-40 text-xs"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Badge tone="info">{m.roleName}</Badge>
                    )}
                  </TD>
                  <TD className="hidden text-fg-muted md:table-cell">
                    {m.lastAccessAt ? formatDateTime(m.lastAccessAt) : "Ainda não entrou"}
                  </TD>
                  <TD className="hidden text-fg-muted lg:table-cell">{formatDate(m.joinedAt)}</TD>
                  {internal && canManage ? (
                    <TD className="text-right">
                      <ConfirmDialog
                        title={`Remover o acesso de ${m.name}?`}
                        description="A pessoa deixa de ver este cliente imediatamente. Sem outros clientes, o acesso dela à área do cliente é suspenso."
                        confirmLabel="Remover acesso"
                        onConfirm={() => remove.run({ clientId, membershipId: m.membershipId })}
                        trigger={
                          <Button variant="danger-ghost" size="xs" aria-label={`Remover acesso de ${m.name}`}>
                            <UserMinus />
                          </Button>
                        }
                      />
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {internal ? (
          <p className="px-5 pt-1 pb-4 text-xs text-fg-subtle">
            O papel vale para todos os clientes que a pessoa acessa nesta agência.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Convites</CardTitle>
            <CardDescription>
              Cada link é pessoal, de uso único e expira. Um convite só conta como aceito depois do login.
            </CardDescription>
          </div>
        </CardHeader>
        {data.invites.length === 0 ? (
          <EmptyState compact icon={Mail} title="Nenhum convite" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Convidado</TH>
                <TH className="hidden sm:table-cell">Papel</TH>
                <TH>Situação</TH>
                <TH className="hidden md:table-cell">Validade</TH>
                {canManage ? <TH className="text-right">Ações</TH> : null}
              </tr>
            </THead>
            <TBody>
              {data.invites.map((inv) => (
                <TR key={inv.id}>
                  <TD>
                    <span className="block font-medium">{inv.name ?? inv.email}</span>
                    {inv.name ? <span className="block text-xs text-fg-muted">{inv.email}</span> : null}
                    <span className="block text-xs text-fg-subtle">
                      {inv.invitedBy ?? "—"} · {formatDate(inv.createdAt)}
                    </span>
                  </TD>
                  <TD className="hidden sm:table-cell">{inv.roleName}</TD>
                  <TD>
                    <span className="flex flex-col items-start gap-1">
                      <Badge tone={INVITE_STATUS[inv.status].tone}>{INVITE_STATUS[inv.status].label}</Badge>
                      {inv.status === "pending" ? <EmailStateBadge state={inv.emailState} /> : null}
                    </span>
                  </TD>
                  <TD className="hidden text-fg-muted md:table-cell">até {formatDate(inv.expiresAt)}</TD>
                  {canManage ? (
                    <TD className="text-right">
                      {inv.manageable || (inv.status === "expired" && internal) ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => resend.run({ clientId, invitationId: inv.id })}
                            disabled={resend.pending}
                          >
                            <RefreshCw /> Reenviar
                          </Button>
                          {inv.status === "pending" ? (
                            <Button
                              variant="danger-ghost"
                              size="xs"
                              onClick={() => revoke.run({ clientId, invitationId: inv.id })}
                              disabled={revoke.pending}
                            >
                              <X /> Revogar
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Dialog open={inviteOpen} onOpenChange={closeInvite}>
        <DialogContent size="md">
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle>{result.kind === "granted" ? "Acesso incluído" : "Convite criado"}</DialogTitle>
                <DialogDescription>
                  {result.kind === "granted"
                    ? "Esta pessoa já tinha conta na área do cliente desta agência: agora ela também acessa este cliente."
                    : "O convite só vale depois que a pessoa entrar com este e-mail."}
                </DialogDescription>
              </DialogHeader>
              {result.kind === "invite" ? (
                <DialogBody>
                  <InviteResult url={result.url} email={result.email} validityDays={result.days} />
                </DialogBody>
              ) : null}
              <DialogFooter>
                <Button variant="secondary" onClick={() => setResult(null)}>
                  Convidar outra pessoa
                </Button>
                <Button variant="primary" onClick={() => closeInvite(false)}>
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
                const validityDays = Number(f.get("validityDays") ?? INVITE_VALIDITY.default);
                setDays(validityDays);
                invite.run({
                  clientId,
                  email: String(f.get("email") ?? ""),
                  name: String(f.get("name") ?? ""),
                  roleId,
                  validityDays,
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>Convidar para o portal</DialogTitle>
                <DialogDescription>A pessoa recebe acesso apenas a este cliente.</DialogDescription>
              </DialogHeader>
              <DialogBody className="grid gap-4">
                <Field label="E-mail" htmlFor="inv-email" required error={invite.fieldErrors.email}>
                  <Input
                    id="inv-email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    placeholder="nome@empresa.com.br"
                  />
                </Field>
                <InviteExtraFields errors={invite.fieldErrors} />
                <Field
                  label="Papel"
                  htmlFor="inv-role"
                  required
                  error={invite.fieldErrors.roleId}
                  hint={role?.description ?? undefined}
                >
                  <NativeSelect id="inv-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                    <option value="">Selecione…</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => closeInvite(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={invite.pending} disabled={!roleId}>
                  Criar convite
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!resent} onOpenChange={(o) => !o && setResent(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Novo link gerado</DialogTitle>
            <DialogDescription>O link anterior deixou de funcionar.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {resent ? (
              <InviteResult url={resent.url} email={resent.email} validityDays={INVITE_VALIDITY.default} />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
