import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { runDueSchedules } from "@/server/events/schedules";
import { env } from "@/server/env";
import { sendPendingEmails } from "@/server/mail/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  if (!env.CRON_SECRET) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Processamento em lotes para plataformas sem worker contínuo (ex.: Vercel Cron).
 * Executa: um lote de eventos, um lote de e-mails e as rotinas diárias
 * (idempotentes). Protegido por `Authorization: Bearer CRON_SECRET`.
 */
async function handle(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron desativado: defina CRON_SECRET." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const startedAt = Date.now();
  const events = await dispatchPendingEvents(100);
  const emails = await sendPendingEmails(50);
  const schedules = await runDueSchedules();
  return NextResponse.json({ ok: true, events, emails, schedules, ms: Date.now() - startedAt });
}

export const GET = handle;
export const POST = handle;
