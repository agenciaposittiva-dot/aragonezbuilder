import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";
import { db } from "@/server/db";
import { emailOutbox } from "@/server/db/schema";
import { env } from "@/server/env";
import { SMTP_MISSING } from "./index";

export const MAX_EMAIL_ATTEMPTS = 8;

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

/**
 * Envia e-mails pendentes da fila. Sem SMTP configurado, nada é enviado nem
 * marcado como enviado: o registro fica com o erro "SMTP não configurado" (e
 * não é tentado de novo), e o conteúdo — que pode ter links de convite ou de
 * senha — nunca vai para o log.
 */
export async function sendPendingEmails(limit = 20): Promise<{ sent: number; failed: number; skipped: number }> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  const pending = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        isNull(emailOutbox.sentAt),
        lt(emailOutbox.attempts, MAX_EMAIL_ATTEMPTS),
        or(
          eq(emailOutbox.attempts, 0),
          sql`${emailOutbox.createdAt} < now() - (interval '1 minute' * power(2, ${emailOutbox.attempts}))`,
        ),
      ),
    )
    .orderBy(asc(emailOutbox.createdAt))
    .limit(limit);

  for (const { id } of pending) {
    try {
      await db.transaction(async (tx) => {
        const [mail] = await tx
          .select()
          .from(emailOutbox)
          .where(and(eq(emailOutbox.id, id), isNull(emailOutbox.sentAt)))
          .for("update", { skipLocked: true });
        if (!mail) return;
        const transport = getTransport();
        if (!transport) {
          await tx
            .update(emailOutbox)
            .set({ attempts: MAX_EMAIL_ATTEMPTS, lastError: SMTP_MISSING })
            .where(eq(emailOutbox.id, id));
          result.skipped++;
          return;
        }
        await transport.sendMail({
          from: env.SMTP_FROM,
          to: mail.to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        await tx
          .update(emailOutbox)
          .set({ sentAt: new Date(), attempts: mail.attempts + 1, lastError: null })
          .where(eq(emailOutbox.id, id));
        result.sent++;
      });
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[e-mail] falha ao enviar ${id}:`, message);
      await db
        .update(emailOutbox)
        .set({ attempts: sql`${emailOutbox.attempts} + 1`, lastError: message.slice(0, 1000) })
        .where(eq(emailOutbox.id, id));
    }
  }
  return result;
}
