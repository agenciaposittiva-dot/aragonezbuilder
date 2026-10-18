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
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOrgAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/format";
import { resendInvitationAction, revokeInvitationAction } from "@/server/actions/team";
import type { EmailDeliveryState } from "@/server/mail";
import { EmailStateBadge, InviteResult } from "./invite-result";

type Status = "pending" | "accepted" | "expired" | "revoked";

type Invitation = {
  id: string;
  email: string;
  name: string | null;
  emailState: EmailDeliveryState;
  roleName: string;
  roleKind: "internal" | "client";
  orgName: string;
  clientNames: string[];
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedBy: string | null;
};

const LABEL: Record<Status, string> = {
  pending: "Pendentes",
  accepted: "Aceitos",
  expired: "Expirados",
  revoked: "Revogados",
};

const EMPTY: Record<Status, { title: string; description: string }> = {
  pending: { title: "Nenhum convite pendente", description: "Use “Convidar” para dar acesso a uma pessoa." },
  accepted: { title: "Nenhum convite aceito", description: "Quem aceita um convite vira membro com o papel definido." },
  expired: { title: "Nenhum convite expirado", description: "Convites não usados dentro da validade aparecem aqui." },
  revoked: { title: "Nenhum convite revogado", description: "Convites cancelados aparecem aqui." },
};

/**
 * Convites por situação. Pendentes e expirados podem ser reenviados (novo
 * link de uso único e nova validade; o anterior deixa de funcionar) ou
 * cancelados. Aceitos e revogados ficam como histórico.
 */
export function InvitationsList({
  invitations,
  status,
  counts,
  base,
  canManage,
}: {
  invitations: Invitation[];
  status: Status;
  counts: Record<Status, number>;
  base: string;
  canManage: boolean;
}) {
  const [result, setResult] = useState<{ url: string; email: EmailDeliveryState } | null>(null);
  const resend = useOrgAction(resendInvitationAction, {
    success: "Novo link gerado",
    onSuccess: (d) => setResult({ url: d.url, email: d.email }),
  });
  const revoke = useOrgAction(revokeInvitationAction, { success: "Convite cancelado" });
  const actionable = canManage && (status === "pending" || status === "expired");

  return (
    // Coluna flexível (não grid): a tabela rola dentro do cartão sem alargar a página no celular.
    <div className="flex min-w-0 flex-col gap-3">
      <SegmentedNav
        param="status"
        className="self-start"
        items={(Object.keys(LABEL) as Status[]).map((s) => ({
          label: counts[s] ? `${LABEL[s]} (${counts[s]})` : LABEL[s],
          value: s,
          href: `${base}?tab=invites&status=${s}`,
        }))}
      />
      {!invitations.length ? (
        <Card>
          <EmptyState icon={Mail} title={EMPTY[status].title} description={EMPTY[status].description} />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>E-mail</TH>
                <TH>Agência e papel</TH>
                <TH className="hidden md:table-cell">Enviado por</TH>
                <TH>
                  {status === "accepted"
                    ? "Aceito em"
                    : status === "revoked"
                      ? "Revogado em"
                      : status === "expired"
                        ? "Expirou em"
                        : "Validade"}
                </TH>
                {actionable ? <TH className="text-right">Ações</TH> : null}
              </tr>
            </THead>
            <TBody>
              {invitations.map((inv) => (
                <TR key={inv.id} data-testid="invitation-row">
                  <TD>
                    <span className="block font-medium break-all">{inv.name ?? inv.email}</span>
                    {inv.name ? <span className="block text-xs break-all text-fg-muted">{inv.email}</span> : null}
                    {status === "pending" || status === "expired" ? (
                      <span className="mt-1 block">
                        <EmailStateBadge state={inv.emailState} />
                      </span>
                    ) : null}
                  </TD>
                  <TD>
                    <span className="block text-xs text-fg-muted">{inv.orgName}</span>
                    <Badge tone={inv.roleKind === "client" ? "info" : "neutral"}>{inv.roleName}</Badge>
                    {inv.clientNames.length ? (
                      <span className="mt-1 block text-xs text-fg-muted">Clientes: {inv.clientNames.join(", ")}</span>
                    ) : null}
                  </TD>
                  <TD className="hidden text-fg-muted md:table-cell">
                    {inv.invitedBy ?? "—"} · {formatDate(inv.createdAt)}
                  </TD>
                  <TD className="text-xs text-fg-muted">
                    {status === "accepted" && inv.acceptedAt
                      ? formatDate(inv.acceptedAt)
                      : status === "revoked" && inv.revokedAt
                        ? formatDate(inv.revokedAt)
                        : status === "expired"
                          ? formatDate(inv.expiresAt)
                          : `até ${formatDate(inv.expiresAt)}`}
                  </TD>
                  {actionable ? (
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
        </Card>
      )}
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
    </div>
  );
}
