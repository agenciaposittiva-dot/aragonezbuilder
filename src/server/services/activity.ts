import { auditLogs, domainEvents } from "@/server/db/schema";
import type { Scope } from "@/server/authz";

export type Changes = Record<string, { from: unknown; to: unknown }>;

export type ActivityEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  changes?: Changes;
  metadata?: Record<string, unknown>;
  /** Aparece no histórico da área do cliente. */
  clientVisible?: boolean;
  /**
   * Evento de domínio emitido na mesma transação (padrão outbox).
   * Por padrão o tipo é `${entityType}.${action}`. Use `false` para não emitir.
   */
  event?: { type?: string; payload?: Record<string, unknown> } | false;
};

/**
 * Registra auditoria e, opcionalmente, um evento de domínio — ambos na transação
 * da operação. Se a operação falhar, nada é registrado; se for confirmada, o
 * worker processa o evento (notificações, automações, integrações).
 */
export async function recordActivity(s: Scope, entry: ActivityEntry) {
  await s.db.insert(auditLogs).values({
    organizationId: s.actor.orgId,
    actorUserId: s.actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    changes: entry.changes && Object.keys(entry.changes).length ? entry.changes : null,
    metadata: entry.metadata ?? null,
    clientVisible: entry.clientVisible ?? false,
  });

  if (entry.event !== false) {
    await s.db.insert(domainEvents).values({
      organizationId: s.actor.orgId,
      type: entry.event?.type ?? `${entry.entityType}.${entry.action}`,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      actorUserId: s.actor.userId,
      payload: entry.event?.payload ?? {},
    });
  }
}

/** Compara campos e devolve apenas o que mudou. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields?: (keyof T)[]): Changes {
  const changes: Changes = {};
  const keys = (fields ?? (Object.keys(after) as (keyof T)[])).filter((k) => k in after);
  for (const key of keys) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[String(key)] = { from, to };
  }
  return changes;
}

function normalize(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === "") return null;
  return value;
}
