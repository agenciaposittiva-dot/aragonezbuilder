import { emailOutbox } from "@/server/db/schema";
import { env } from "@/server/env";
import type { Tx } from "@/server/db";
import { db as rootDb } from "@/server/db";
import { APP_NAME } from "@/lib/constants";

export type EmailMessage = { to: string; subject: string; html: string; text: string };

/**
 * Enfileira um e-mail. O envio real acontece no worker (com novas tentativas),
 * para não prender a requisição HTTP. Devolve o id do registro na fila.
 */
export async function enqueueEmail(message: EmailMessage, tx?: Tx): Promise<string> {
  const executor = tx ?? rootDb;
  const [row] = await executor.insert(emailOutbox).values(message).returning({ id: emailOutbox.id });
  return row!.id;
}

/** Há um provedor real de e-mail configurado (SMTP)? */
export function emailConfigured() {
  return !!env.SMTP_HOST;
}

export const SMTP_MISSING = "SMTP não configurado";

export type EmailDeliveryState = "sent" | "queued" | "failed" | "not_configured";

/** Estado real de um e-mail da fila (nunca "enviado" sem confirmação do provedor). */
export function emailDeliveryState(row: {
  sentAt: Date | null;
  lastError: string | null;
  attempts: number;
}): EmailDeliveryState {
  if (row.sentAt) return "sent";
  if (row.lastError === SMTP_MISSING) return "not_configured";
  if (row.lastError) return "failed";
  return emailConfigured() ? "queued" : "not_configured";
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Layout simples e legível em qualquer cliente de e-mail. */
export function renderEmail(opts: {
  title: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
}): { html: string; text: string } {
  const p = opts.paragraphs
    .map((t) => `<p style="margin:0 0 16px;line-height:1.6;color:#334155">${escapeHtml(t)}</p>`)
    .join("");
  const button = opts.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.action.url)}" style="background:#121110;color:#f4bf2f;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(opts.action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#64748b">Se o botão não funcionar, copie este endereço: ${escapeHtml(opts.action.url)}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:700;font-size:15px;color:#0f172a;margin-bottom:24px">${escapeHtml(APP_NAME)}</div>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
      <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapeHtml(opts.title)}</h1>
      ${p}${button}
    </div>
    <p style="font-size:12px;color:#94a3b8;margin-top:20px">${escapeHtml(opts.footer ?? "Você recebeu este e-mail porque tem uma conta ou um convite na plataforma.")}</p>
  </div></body></html>`;
  const text = [
    opts.title,
    "",
    ...opts.paragraphs,
    ...(opts.action ? ["", `${opts.action.label}: ${opts.action.url}`] : []),
  ].join("\n");
  return { html, text };
}
