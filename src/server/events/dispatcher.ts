import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { domainEvents } from "@/server/db/schema";
import { processFileVersion } from "@/server/services/file-processing";
import { runAutomations } from "./automation-engine";
import { applyNotifications, type DomainEvent } from "./notifications";

/** Depois deste número de tentativas o evento é abandonado (fica com last_error). */
export const MAX_EVENT_ATTEMPTS = 6;

/** Efeitos colaterais assíncronos que não são notificações nem automações. */
async function sideEffects(ev: DomainEvent) {
  if (ev.type === "file.version_uploaded" || ev.type === "file.uploaded") {
    const versionId = (ev.payload as { versionId?: string })?.versionId;
    if (versionId) await processFileVersion(ev.organizationId, versionId);
  }
}

export type DispatchResult = { processed: number; failed: number; skipped: number };

/**
 * Processa um evento com exatamente-uma-vez para os efeitos no banco:
 * o evento é travado (FOR UPDATE SKIP LOCKED), notificações e execuções de
 * automações são gravadas na MESMA transação que marca processed_at. Se algo
 * falhar, tudo é desfeito e a tentativa é contabilizada para nova execução.
 * Webhooks e e-mails são "pelo menos uma vez".
 */
export async function processEvent(id: string): Promise<"processed" | "skipped" | "failed"> {
  try {
    return await withSystem(async (tx) => {
      const [ev] = await tx
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.id, id), isNull(domainEvents.processedAt)))
        .for("update", { skipLocked: true });
      if (!ev) return "skipped" as const;
      await applyNotifications(tx, ev);
      await runAutomations(tx, ev);
      await sideEffects(ev);
      await tx
        .update(domainEvents)
        .set({ processedAt: new Date(), attempts: ev.attempts + 1, lastError: null })
        .where(eq(domainEvents.id, ev.id));
      return "processed" as const;
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? `${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ""}`
        : String(err);
    console.error(`[eventos] falha ao processar ${id}:`, message);
    await withSystem((tx) =>
      tx
        .update(domainEvents)
        .set({ attempts: sql`${domainEvents.attempts} + 1`, lastError: message.slice(0, 2000) })
        .where(eq(domainEvents.id, id)),
    );
    return "failed";
  }
}

/**
 * Processa um lote de eventos pendentes em ordem de criação. Eventos com
 * falha voltam após um intervalo crescente (30 s × 2^tentativas).
 */
export async function dispatchPendingEvents(limit = 50): Promise<DispatchResult> {
  const pending = await withSystem((tx) =>
    tx
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          isNull(domainEvents.processedAt),
          lt(domainEvents.attempts, MAX_EVENT_ATTEMPTS),
          or(
            eq(domainEvents.attempts, 0),
            sql`${domainEvents.createdAt} < now() - (interval '30 seconds' * power(2, ${domainEvents.attempts}))`,
          ),
        ),
      )
      .orderBy(asc(domainEvents.createdAt))
      .limit(limit),
  );
  const result: DispatchResult = { processed: 0, failed: 0, skipped: 0 };
  for (const { id } of pending) result[await processEvent(id)]++;
  return result;
}
