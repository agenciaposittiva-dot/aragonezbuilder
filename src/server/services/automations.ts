import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { EVENT_CATALOG, type EventType } from "@/lib/events";
import { ruleInput } from "@/lib/validators/automations";
import { inSequence } from "@/server/db/sequence";
import {
  automationRules,
  automationRuns,
  clients,
  domainEvents,
  projects,
  roles,
  workflowStatuses,
  type AutomationAction,
  type AutomationCondition,
} from "@/server/db/schema";
import { assertCan, assertInternal, can, type Scope } from "@/server/authz";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertSafeWebhookUrl, webhookSecret, WebhookUrlError } from "@/server/events/webhook";
import { recordActivity } from "./activity";
import { assertActiveMembers, listInternalMembers } from "./members";

function readAccess(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "automations.read");
}

export async function listRules(s: Scope) {
  readAccess(s);
  return s.db
    .select({
      id: automationRules.id,
      name: automationRules.name,
      description: automationRules.description,
      trigger: automationRules.trigger,
      conditions: automationRules.conditions,
      actions: automationRules.actions,
      enabled: automationRules.enabled,
      lastRunAt: automationRules.lastRunAt,
      updatedAt: automationRules.updatedAt,
      runs30d: sql<number>`(select count(*)::int from ${automationRuns} r where r.rule_id = ${automationRules.id} and r.status <> 'skipped' and r.started_at > now() - interval '30 days')`,
      failed30d: sql<number>`(select count(*)::int from ${automationRuns} r where r.rule_id = ${automationRules.id} and r.status = 'failed' and r.started_at > now() - interval '30 days')`,
      lastStatus: sql<
        string | null
      >`(select r.status::text from ${automationRuns} r where r.rule_id = ${automationRules.id} and r.status <> 'skipped' order by r.started_at desc limit 1)`,
    })
    .from(automationRules)
    .orderBy(desc(automationRules.enabled), asc(automationRules.name));
}

export type RuleRow = Awaited<ReturnType<typeof listRules>>[number];

export async function getRule(s: Scope, id: string) {
  readAccess(s);
  const [rule] = await s.db.select().from(automationRules).where(eq(automationRules.id, id));
  if (!rule) throw new NotFoundError("Automação não encontrada.");
  return rule;
}

export async function listRuns(s: Scope, ruleId: string, limit = 100) {
  readAccess(s);
  await getRule(s, ruleId);
  return s.db
    .select({
      id: automationRuns.id,
      status: automationRuns.status,
      result: automationRuns.result,
      error: automationRuns.error,
      startedAt: automationRuns.startedAt,
      finishedAt: automationRuns.finishedAt,
      eventType: domainEvents.type,
      eventPayload: domainEvents.payload,
    })
    .from(automationRuns)
    .leftJoin(domainEvents, eq(domainEvents.id, automationRuns.eventId))
    .where(eq(automationRuns.ruleId, ruleId))
    .orderBy(desc(automationRuns.startedAt))
    .limit(limit);
}

/** Valida referências das ações (membros, status, URLs) dentro da organização. */
async function validateRule(
  s: Scope,
  trigger: EventType,
  conditions: AutomationCondition[],
  actions: AutomationAction[],
) {
  const fields = new Set<string>(EVENT_CATALOG[trigger].fields.map((f) => f.key));
  for (const c of conditions) {
    if (!fields.has(c.field)) throw new ValidationError(`O campo "${c.field}" não existe no gatilho escolhido.`);
    if (c.op !== "exists" && (c.value === undefined || c.value === "" || (Array.isArray(c.value) && !c.value.length))) {
      throw new ValidationError("Preencha o valor de todas as condições.");
    }
  }
  const memberIds = actions.flatMap((a) =>
    a.type === "notify_members"
      ? (a.membershipIds ?? [])
      : a.type === "create_task" && a.assigneeMembershipId
        ? [a.assigneeMembershipId]
        : [],
  );
  await assertActiveMembers(s, memberIds);

  const roleKeys = actions.flatMap((a) => (a.type === "notify_members" ? (a.roleKeys ?? []) : []));
  if (roleKeys.length) {
    const found = await s.db.select({ key: roles.key }).from(roles).where(inArray(roles.key, roleKeys));
    if (found.length !== new Set(roleKeys).size) throw new ValidationError("Um dos papéis selecionados não existe.");
  }

  const statusKeys = actions.flatMap((a) => (a.type === "set_task_status" ? [a.statusKey] : []));
  if (statusKeys.length) {
    const found = await s.db
      .select({ key: workflowStatuses.key })
      .from(workflowStatuses)
      .where(and(eq(workflowStatuses.entity, "task"), inArray(workflowStatuses.key, statusKeys)));
    if (found.length !== new Set(statusKeys).size) throw new ValidationError("Status de tarefa inválido na ação.");
  }

  for (const a of actions) {
    if (a.type !== "webhook") continue;
    try {
      assertSafeWebhookUrl(a.url);
    } catch (err) {
      if (err instanceof WebhookUrlError) throw new ValidationError(`Webhook: ${err.message}`);
      throw err;
    }
  }
}

export async function saveRule(s: Scope, raw: z.input<typeof ruleInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "automations.manage");
  const data = ruleInput.parse(raw);
  const trigger = data.trigger as EventType;
  const conditions = data.conditions as AutomationCondition[];
  const actions = data.actions as AutomationAction[];
  await validateRule(s, trigger, conditions, actions);

  const values = {
    name: data.name,
    description: data.description ?? null,
    trigger,
    conditions,
    actions,
    enabled: data.enabled,
  };
  if (data.id) {
    await getRule(s, data.id);
    await s.db.update(automationRules).set(values).where(eq(automationRules.id, data.id));
    await recordActivity(s, {
      action: "updated",
      entityType: "automation",
      entityId: data.id,
      summary: `Automação "${data.name}" atualizada`,
      event: false,
    });
    return { id: data.id };
  }
  const [row] = await s.db
    .insert(automationRules)
    .values({ ...values, organizationId: s.actor.orgId, createdByUserId: s.actor.userId })
    .returning({ id: automationRules.id });
  await recordActivity(s, {
    action: "created",
    entityType: "automation",
    entityId: row!.id,
    summary: `Automação "${data.name}" criada`,
    event: false,
  });
  return { id: row!.id };
}

export async function setRuleEnabled(s: Scope, id: string, enabled: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "automations.manage");
  const rule = await getRule(s, id);
  await s.db.update(automationRules).set({ enabled }).where(eq(automationRules.id, id));
  await recordActivity(s, {
    action: enabled ? "enabled" : "disabled",
    entityType: "automation",
    entityId: id,
    summary: `Automação "${rule.name}" ${enabled ? "ativada" : "pausada"}`,
    event: false,
  });
}

export async function deleteRule(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "automations.manage");
  const rule = await getRule(s, id);
  await s.db.delete(automationRules).where(eq(automationRules.id, id));
  await recordActivity(s, {
    action: "deleted",
    entityType: "automation",
    entityId: id,
    summary: `Automação "${rule.name}" excluída`,
    event: false,
  });
}

/** Dados auxiliares do construtor de regras. */
export async function ruleBuilderOptions(s: Scope) {
  readAccess(s);
  const [members, roleRows, statuses, clientRows, projectRows] = await inSequence(
    () => listInternalMembers(s),
    () => s.db.select({ key: roles.key, name: roles.name, kind: roles.kind }).from(roles).orderBy(asc(roles.name)),
    () =>
      s.db
        .select({ key: workflowStatuses.key, name: workflowStatuses.name, entity: workflowStatuses.entity })
        .from(workflowStatuses)
        .orderBy(asc(workflowStatuses.position)),
    () =>
      s.db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(sql`${clients.archivedAt} is null and ${clients.deletedAt} is null`)
        .orderBy(asc(clients.name)),
    () =>
      s.db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(sql`${projects.archivedAt} is null and ${projects.deletedAt} is null`)
        .orderBy(asc(projects.name)),
  );
  return {
    members: members.map((m) => ({ id: m.membershipId, name: m.name })),
    roles: roleRows.filter((r) => r.kind === "internal").map((r) => ({ key: r.key, name: r.name })),
    taskStatuses: statuses.filter((st) => st.entity === "task").map((st) => ({ key: st.key, name: st.name })),
    projectStatuses: statuses.filter((st) => st.entity === "project").map((st) => ({ key: st.key, name: st.name })),
    clients: clientRows,
    projects: projectRows,
  };
}

/** Segredo para validar a assinatura dos webhooks (somente quem gerencia automações). */
export function getWebhookSecret(s: Scope): string | null {
  return s.actor.kind === "internal" && can(s.actor, "automations.manage") ? webhookSecret(s.actor.orgId) : null;
}
