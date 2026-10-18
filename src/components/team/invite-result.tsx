"use client";

import { AlertTriangle, CheckCircle2, Clock, MailX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EmailDeliveryState } from "@/server/mail";
import { CopyLink } from "./invite-dialog";

const STATE = {
  sent: { label: "E-mail enviado", tone: "success", icon: CheckCircle2 },
  queued: { label: "E-mail na fila", tone: "neutral", icon: Clock },
  failed: { label: "Falha no envio", tone: "danger", icon: AlertTriangle },
  not_configured: { label: "E-mail não enviado", tone: "warning", icon: MailX },
} as const;

/** Estado real do e-mail do convite (nunca "enviado" sem confirmação do provedor). */
export function EmailStateBadge({ state }: { state: EmailDeliveryState }) {
  const s = STATE[state];
  return (
    <span title={state === "not_configured" ? "SMTP não configurado" : undefined}>
      <Badge tone={s.tone}>
        <s.icon className="size-3" /> {s.label}
      </Badge>
    </span>
  );
}

/** Depois de criar ou reenviar um convite: link para copiar + o que aconteceu com o e-mail. */
export function InviteResult({
  url,
  email,
  validityDays,
}: {
  url: string;
  email: EmailDeliveryState;
  validityDays?: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {email === "not_configured" ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
          O e-mail <strong className="font-medium">não foi enviado</strong>: nenhum provedor de e-mail (SMTP) está
          configurado. Copie o link abaixo e envie para a pessoa por outro canal.
        </p>
      ) : (
        <p className="text-sm text-fg-muted">
          O e-mail entrou na fila de envio; o estado real aparece na lista de convites. Você também pode copiar o link e
          enviar por outro canal.
        </p>
      )}
      <CopyLink url={url} />
      <p className="text-xs text-fg-subtle">
        O link é pessoal e vale para um único uso{validityDays ? `; expira em ${validityDays} dias` : ""}.
      </p>
    </div>
  );
}
