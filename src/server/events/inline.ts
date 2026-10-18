import { after } from "next/server";
import { env } from "@/server/env";
import { sendPendingEmails } from "@/server/mail/sender";
import { dispatchPendingEvents } from "./dispatcher";

/**
 * Agenda o processamento dos eventos e e-mails pendentes para depois que a
 * resposta for enviada (não atrasa o usuário). Útil onde não há worker
 * contínuo, como na Vercel. O despacho é idempotente e usa SKIP LOCKED, então
 * convive com o worker e com o cron sem duplicar nada.
 */
export function processEventsInBackground() {
  if (!env.EVENTS_INLINE) return;
  try {
    after(async () => {
      try {
        await dispatchPendingEvents(25);
        await sendPendingEmails(10);
      } catch (err) {
        console.error("[eventos] falha no processamento após a resposta", err);
      }
    });
  } catch {
    // Fora do contexto de uma requisição (scripts, testes): o worker/cron processa.
  }
}
