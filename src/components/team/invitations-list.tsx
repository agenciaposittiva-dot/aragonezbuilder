"use client";

import { Mail, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/format";
import { resendInvitationAction, revokeInvitationAction } from "@/server/actions/team";
import type { EmailDeliveryState } from "@/server/mail";
import { EmailStateBadge, InviteResult } from "./invite-result";

type Invitation = {
  id: string;
  email: string;
  name: string | null;
  emailState: EmailDeliveryState;
  roleName: string;
  roleKind: "internal" | "client";
  expiresAt: Date;
  createdAt: Date;
  invitedBy: string | null;
  expired: boolean;
};

export function InvitationsList({ invitations, canManage }: { invitations: Invitation[]; canManage: boolean }) {
  const [result, setResult] = useState<{ url: string; email: EmailDeliveryState } | null>(null);
  const resend = useOrgAction(resendInvitationAction, {
    success: "Novo link gerado",
    onSuccess: (d) => setResult({ url: d.url, email: d.email }),
  });
  const revoke = useOrgAction(revokeInvitationAction, { success: "Convite cancelado" });

  if (!invitations.length) {
    return (
      <Card>
        <EmptyState
          icon={Mail}
          title="Nenhum convite pendente"
          description="Convites aceitos viram membros; os pendentes aparecem aqui."
        />
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <THead>
          <tr>
            <TH>E-mail</TH>
            <TH>Papel</TH>
            <TH className="hidden md:table-cell">Enviado por</TH>
            <TH>Validade</TH>
            {canManage ? <TH className="text-right">Ações</TH> : null}
          </tr>
        </THead>
        <TBody>
          {invitations.map((inv) => (
            <TR key={inv.id}>
              <TD>
                <span className="block font-medium">{inv.name ?? inv.email}</span>
                {inv.name ? <span className="block text-xs text-fg-muted">{inv.email}</span> : null}
                <span className="mt-1 block">
                  <EmailStateBadge state={inv.emailState} />
                </span>
              </TD>
              <TD>
                <Badge tone={inv.roleKind === "client" ? "info" : "neutral"}>{inv.roleName}</Badge>
              </TD>
              <TD className="hidden text-fg-muted md:table-cell">
                {inv.invitedBy ?? "—"} · {formatDate(inv.createdAt)}
              </TD>
              <TD>
                {inv.expired ? (
                  <Badge tone="danger">Expirado</Badge>
                ) : (
                  <span className="text-xs text-fg-muted">até {formatDate(inv.expiresAt)}</span>
                )}
              </TD>
              {canManage ? (
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => resend.run({ id: inv.id })}
                      disabled={resend.pending}
                    >
                      <RefreshCw /> Reenviar
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="xs"
                      onClick={() => revoke.run({ id: inv.id })}
                      disabled={revoke.pending}
                    >
                      <X /> Cancelar
                    </Button>
                  </div>
                </TD>
              ) : null}
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Novo link gerado</DialogTitle>
            <DialogDescription>O link anterior deixou de funcionar.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {result ? <InviteResult url={result.url} email={result.email} validityDays={7} /> : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
