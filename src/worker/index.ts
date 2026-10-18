/**
 * Worker de processamento assíncrono.
 *
 *  - Eventos de domínio: acordado por LISTEN/NOTIFY (canal domain_events) e
 *    por varredura a cada 10 s; gera notificações, executa automações e
 *    efeitos colaterais (ex.: miniaturas de arquivos).
 *  - Fila de e-mails: varredura a cada 5 s.
 *  - Rotinas agendadas (pg-boss): tarefas atrasadas, faturas vencidas,
 *    faturas recorrentes e lembretes de aprovação.
 *
 * Uso: npm run worker   (desenvolvimento: npm run dev:worker)
 */
import "./load-env";
import { Client } from "pg";
import { PgBoss } from "pg-boss";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { SCHEDULES } from "@/server/events/schedules";
import { sendPendingEmails } from "@/server/mail/sender";
import { pool } from "@/server/db";

const ownerUrl = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL;
if (!ownerUrl) throw new Error("Defina DATABASE_OWNER_URL (ou DATABASE_URL).");

const TZ = "America/Sao_Paulo";
let stopping = false;

/** Executa `fn` sem sobreposição; chamadas durante a execução agendam mais uma rodada. */
function singleFlight(name: string, fn: () => Promise<unknown>) {
  let running = false;
  let again = false;
  const run = async (): Promise<void> => {
    if (stopping) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await fn();
      } while (again && !stopping);
    } catch (err) {
      console.error(`[worker] ${name}:`, err);
    } finally {
      running = false;
    }
  };
  return run;
}

async function main() {
  const dispatch = singleFlight("eventos", async () => {
    // Drena a fila em lotes até não haver mais pendências imediatas.
    for (let i = 0; i < 20; i++) {
      const r = await dispatchPendingEvents(50);
      if (r.processed || r.failed) console.log(`[eventos] processados ${r.processed}, falhas ${r.failed}`);
      if (r.processed + r.failed + r.skipped < 50) break;
    }
  });
  const emails = singleFlight("e-mails", async () => {
    const r = await sendPendingEmails(20);
    if (r.sent || r.failed) console.log(`[e-mail] enviados ${r.sent}, falhas ${r.failed}`);
  });

  // Rotinas agendadas com pg-boss (schema próprio: pgboss).
  const boss = new PgBoss({ connectionString: ownerUrl, schema: "pgboss", application_name: "aragonez-worker" });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();
  for (const job of SCHEDULES) {
    if (!(await boss.getQueue(job.name))) await boss.createQueue(job.name);
    await boss.schedule(job.name, job.cron, null, { tz: TZ });
    await boss.work(job.name, async () => {
      const n = await job.run();
      console.log(`[agenda] ${job.label}: ${n}`);
    });
  }

  // LISTEN em conexão dedicada; reconecta se cair.
  let listener: Client | null = null;
  const connectListener = async () => {
    try {
      listener = new Client({ connectionString: ownerUrl, application_name: "aragonez-listener" });
      listener.on("notification", () => void dispatch());
      listener.on("error", (err) => {
        console.error("[listen] conexão perdida:", err.message);
        listener = null;
        if (!stopping) setTimeout(connectListener, 5000);
      });
      await listener.connect();
      await listener.query("LISTEN domain_events");
    } catch (err) {
      console.error("[listen] falha ao conectar:", (err as Error).message);
      listener = null;
      if (!stopping) setTimeout(connectListener, 5000);
    }
  };
  await connectListener();

  const timers = [setInterval(() => void dispatch(), 10_000), setInterval(() => void emails(), 5_000)];
  void dispatch();
  void emails();
  console.log("✓ Worker em execução (eventos, e-mails e agenda).");

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[worker] ${signal} recebido, encerrando…`);
    timers.forEach(clearInterval);
    try {
      await (listener as Client | null)?.end();
      await boss.stop({ graceful: true, timeout: 15_000 });
      await pool.end();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] falha ao iniciar:", err);
  process.exit(1);
});
