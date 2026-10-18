import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { EVENT_CATALOG } from "@/lib/events";
import { APP_NAME } from "@/lib/constants";
import type { Tx } from "@/server/db";
import {
  auditLogs,
  automationRules,
  automationRuns,
  domainEvents,
  emailOutbox,
  notifications,
  taskDependencies,
  tasks,
  workflowStatuses,
  type AutomationAction,
  type AutomationCondition,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { renderEmail } from "@/server/mail";
import type { DomainEvent } from "./notifications";
import {
  clientUsers,
  membersByIds,
  membersWithRoles,
  orgSlug,
  projectInfo,
  taskInfo,
  type Recipient,
} from "./recipients";
import { postWebhook, webhookSecret } from "./webhook";
import { prefEnabled } from "@/lib/notification-prefs";
import { preferencesFor } from "@/server/services/notification-preferences";
import { releasedDependents, unblockedPayload } from "@/server/services/task-release";

/* ------------------------------------------------------------------ */
/* Condições                                                           */
/* ------------------------------------------------------------------ */

function getField(payload: Record<string, unknown>, field: string): unknown {
  return field
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
      payload,
    );
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string")
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  return value === undefined || value === null ? [] : [String(value)];
}

function asComparable(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** Avalia condições (todas precisam ser verdadeiras). Função pura. */
export function matchesConditions(conditions: AutomationCondition[], payload: Record<string, unknown>): boolean {
  return conditions.every((c) => {
    const actual = getField(payload, c.field);
    switch (c.op) {
      case "exists":
        return actual !== undefined && actual !== null && actual !== "";
      case "eq":
        return String(actual ?? "") === String(c.value ?? "");
      case "neq":
        return String(actual ?? "") !== String(c.value ?? "");
      case "in":
        return asList(c.value).includes(String(actual ?? ""));
      case "contains":
        if (Array.isArray(actual)) return actual.map(String).includes(String(c.value ?? ""));
        return String(actual ?? "")
          .toLowerCase()
          .includes(String(c.value ?? "").toLowerCase());
      case "gt":
      case "lt": {
        const a = asComparable(actual);
        const b = asComparable(c.value);
        if (a === null || b === null) return false;
        return c.op === "gt" ? a > b : a < b;
      }
      default:
        return false;
    }
  });
}

/** Substitui {{campo}} pelos valores do evento (texto puro). */
export function interpolate(template: string, payload: Record<string, unknown>, eventType: string): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    if (key === "evento") return EVENT_CATALOG[eventType as keyof typeof EVENT_CATALOG]?.label ?? eventType;
    const v = getField(payload, key);
    return v === undefined || v === null ? "" : String(v);
  });
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

type Ctx = {
  tx: Tx;
  ev: DomainEvent;
  payload: Record<string, unknown>;
  rule: typeof automationRules.$inferSelect;
  slug: string;
};

function portalPathFor(eventType: string, payload: Record<string, unknown>) {
  if (eventType.startsWith("approval.")) return "/approvals";
  if (eventType.startsWith("request.") && payload.requestId) return `/requests/${payload.requestId}`;
  if (eventType.startsWith("project.") && payload.projectId) return `/projects/${payload.projectId}`;
  if (eventType.startsWith("file.") && payload.fileId) return `/files/${payload.fileId}`;
  return "";
}

function internalPathFor(ev: DomainEvent, payload: Record<string, unknown>) {
  if (payload.taskId) return `/tasks/${payload.taskId}`;
  if (payload.fileId) return `/files/${payload.fileId}`;
  if (payload.requestId) return `/requests/${payload.requestId}`;
  if (payload.projectId) return `/projects/${payload.projectId}`;
  if (payload.invoiceId) return `/finance/invoices`;
  if (payload.clientId) return `/clients/${payload.clientId}`;
  return ev.entityType === "client" && ev.entityId ? `/clients/${ev.entityId}` : "";
}

async function assigneeAndOwner(ctx: Ctx) {
  const task = await taskInfo(ctx.tx, ctx.ev.organizationId, (ctx.payload.taskId as string) ?? null);
  const assignee = (ctx.payload.assigneeMembershipId as string | undefined) ?? task?.assigneeMembershipId ?? null;
  const project = await projectInfo(
    ctx.tx,
    ctx.ev.organizationId,
    (ctx.payload.projectId as string | undefined) ?? task?.projectId ?? null,
  );
  return { assignee, owner: project?.ownerMembershipId ?? null, project };
}

async function notify(
  ctx: Ctx,
  recipients: Recipient[],
  title: string,
  body: string | undefined,
  path: string,
  portalPath: string | null,
) {
  const seen = new Set<string>();
  const rows: (typeof notifications.$inferInsert)[] = [];
  const prefs = await preferencesFor(ctx.tx, ctx.ev.organizationId, [...new Set(recipients.map((r) => r.userId))]);
  for (const r of recipients) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    if (r.kind === "client" && portalPath === null) continue;
    if (!prefEnabled(prefs.get(r.userId), "inApp", "automations")) continue;
    rows.push({
      organizationId: ctx.ev.organizationId,
      userId: r.userId,
      type: `automation.${ctx.rule.id}`,
      title: title.slice(0, 300),
      body: body ? body.slice(0, 1000) : null,
      link: r.kind === "client" ? `/portal/${ctx.slug}/ir${portalPath}` : `/w/${ctx.slug}${path}`,
      entityType: ctx.ev.entityType,
      entityId: ctx.ev.entityId,
    });
  }
  if (rows.length) await ctx.tx.insert(notifications).values(rows);
  return rows.length;
}

async function queueEmails(ctx: Ctx, recipients: Recipient[], subject: string, body: string, link: string) {
  const seen = new Set<string>();
  const prefs = await preferencesFor(ctx.tx, ctx.ev.organizationId, [...new Set(recipients.map((r) => r.userId))]);
  const rows = recipients
    .filter((r) => prefEnabled(prefs.get(r.userId), "email", "automations"))
    .filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)))
    .map((r) => {
      const { html, text } = renderEmail({
        title: subject,
        paragraphs: [`Olá, ${r.name}.`, ...body.split(/\n{2,}/)],
        action: link ? { label: "Abrir na plataforma", url: `${env.APP_URL}${link}` } : undefined,
      });
      return { to: r.email, subject: `${subject} · ${APP_NAME}`, html, text };
    });
  if (rows.length) await ctx.tx.insert(emailOutbox).values(rows);
  return rows.length;
}

/** Evento emitido por uma automação: marcado para não disparar outras automações (evita laços). */
async function emitFromAutomation(
  ctx: Ctx,
  type: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
) {
  await ctx.tx.insert(domainEvents).values({
    organizationId: ctx.ev.organizationId,
    type,
    entityType,
    entityId,
    payload: { ...payload, viaAutomation: ctx.rule.id },
  });
}

async function runAction(ctx: Ctx, action: AutomationAction): Promise<Record<string, unknown>> {
  const org = ctx.ev.organizationId;
  const p = ctx.payload;
  const path = internalPathFor(ctx.ev, p);

  switch (action.type) {
    case "notify_members": {
      const { assignee, owner } = await assigneeAndOwner(ctx);
      const recipients = [
        ...(await membersByIds(ctx.tx, org, [
          ...(action.membershipIds ?? []),
          action.toAssignee ? assignee : null,
          action.toOwner ? owner : null,
        ])),
        ...(await membersWithRoles(ctx.tx, org, action.roleKeys ?? [])),
      ].filter((r) => r.kind === "internal");
      const n = await notify(
        ctx,
        recipients,
        interpolate(action.title, p, ctx.ev.type),
        action.body ? interpolate(action.body, p, ctx.ev.type) : undefined,
        path,
        null,
      );
      return { type: action.type, notified: n };
    }
    case "notify_client": {
      const clientId = (p.clientId as string | undefined) ?? null;
      if (!clientId) throw new Error("O evento não tem cliente associado.");
      const recipients = await clientUsers(ctx.tx, org, clientId);
      const portalPath = portalPathFor(ctx.ev.type, p);
      const title = interpolate(action.title, p, ctx.ev.type);
      const body = action.body ? interpolate(action.body, p, ctx.ev.type) : undefined;
      const n = await notify(ctx, recipients, title, body, path, portalPath);
      const e = action.email
        ? await queueEmails(ctx, recipients, title, body ?? "", `/portal/${ctx.slug}/ir${portalPath}`)
        : 0;
      return { type: action.type, notified: n, emails: e };
    }
    case "email": {
      let recipients: Recipient[] = [];
      let link = path ? `/w/${ctx.slug}${path}` : "";
      if (action.to === "client_users") {
        recipients = await clientUsers(ctx.tx, org, (p.clientId as string | undefined) ?? null);
        link = `/portal/${ctx.slug}/ir${portalPathFor(ctx.ev.type, p)}`;
      } else {
        const { assignee, owner } = await assigneeAndOwner(ctx);
        recipients = await membersByIds(ctx.tx, org, [action.to === "assignee" ? assignee : owner]);
      }
      const n = await queueEmails(
        ctx,
        recipients,
        interpolate(action.subject, p, ctx.ev.type),
        interpolate(action.body, p, ctx.ev.type),
        link,
      );
      return { type: action.type, emails: n };
    }
    case "create_task": {
      const { project } = await assigneeAndOwner(ctx);
      if (!project) throw new Error("O evento não está ligado a um projeto: não há onde criar a tarefa.");
      const [status] = await ctx.tx
        .select({ id: workflowStatuses.id })
        .from(workflowStatuses)
        .where(and(eq(workflowStatuses.organizationId, org), eq(workflowStatuses.entity, "task")))
        .orderBy(desc(workflowStatuses.isDefault), asc(workflowStatuses.position))
        .limit(1);
      if (!status) throw new Error("Nenhum status de tarefa configurado.");
      let assigneeId: string | null = null;
      if (action.assigneeMembershipId) {
        const [m] = await membersByIds(ctx.tx, org, [action.assigneeMembershipId]);
        if (!m || m.kind !== "internal") throw new Error("O responsável configurado não está ativo.");
        assigneeId = action.assigneeMembershipId;
      }
      const [{ max } = { max: 0 }] = await ctx.tx
        .select({ max: sql<number>`coalesce(max(${tasks.position}), 0)::float8` })
        .from(tasks)
        .where(and(eq(tasks.organizationId, org), eq(tasks.projectId, project.id), eq(tasks.statusId, status.id)));
      const dueDate =
        typeof action.dueInDays === "number" && action.dueInDays >= 0
          ? new Date(Date.now() + action.dueInDays * 86_400_000).toISOString().slice(0, 10)
          : null;
      const title = interpolate(action.title, p, ctx.ev.type).slice(0, 300) || "Tarefa automática";
      const [task] = await ctx.tx
        .insert(tasks)
        .values({
          organizationId: org,
          projectId: project.id,
          title,
          description: action.description ? interpolate(action.description, p, ctx.ev.type) : null,
          statusId: status.id,
          assigneeMembershipId: assigneeId,
          dueDate,
          position: Number(max) + 1024,
        })
        .returning({ id: tasks.id });
      await ctx.tx.insert(auditLogs).values({
        organizationId: org,
        action: "created",
        entityType: "task",
        entityId: task!.id,
        summary: `Tarefa criada pela automação "${ctx.rule.name}"`,
      });
      const base = {
        taskId: task!.id,
        projectId: project.id,
        clientId: project.clientId,
        title,
        assigneeMembershipId: assigneeId,
        priority: "medium",
        dueDate,
      };
      await emitFromAutomation(ctx, "task.created", "task", task!.id, base);
      if (assigneeId)
        await emitFromAutomation(ctx, "task.assigned", "task", task!.id, {
          ...base,
          previousAssigneeMembershipId: null,
        });
      return { type: action.type, taskId: task!.id };
    }
    case "set_task_status": {
      const taskId = (p.taskId as string | undefined) ?? (ctx.ev.entityType === "task" ? ctx.ev.entityId : null);
      const task = await taskInfo(ctx.tx, org, taskId);
      if (!task) throw new Error("O evento não está ligado a uma tarefa.");
      const [current] = await ctx.tx
        .select({ completedAt: tasks.completedAt })
        .from(tasks)
        .where(and(eq(tasks.organizationId, org), eq(tasks.id, task.id)));
      const [status] = await ctx.tx
        .select()
        .from(workflowStatuses)
        .where(
          and(
            eq(workflowStatuses.organizationId, org),
            eq(workflowStatuses.entity, "task"),
            eq(workflowStatuses.key, action.statusKey),
          ),
        );
      if (!status) throw new Error(`Status de tarefa "${action.statusKey}" não existe.`);
      const completing = status.category === "done" && !current?.completedAt;
      if (completing) {
        // Mesma regra da tela: não conclui tarefa com dependências abertas.
        const pending = await ctx.tx
          .select({ title: tasks.title })
          .from(taskDependencies)
          .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
          .where(
            and(
              eq(taskDependencies.organizationId, org),
              eq(taskDependencies.taskId, task.id),
              isNull(tasks.completedAt),
              isNull(tasks.archivedAt),
            ),
          );
        if (pending.length)
          throw new Error(
            `A tarefa depende de outras ainda abertas: ${pending.map((d) => `"${d.title}"`).join(", ")}.`,
          );
      }
      await ctx.tx
        .update(tasks)
        .set({
          statusId: status.id,
          completedAt: status.category === "done" ? (current?.completedAt ?? new Date()) : null,
        })
        .where(and(eq(tasks.organizationId, org), eq(tasks.id, task.id)));
      await ctx.tx.insert(auditLogs).values({
        organizationId: org,
        action: "status_changed",
        entityType: "task",
        entityId: task.id,
        summary: `Status alterado para "${status.name}" pela automação "${ctx.rule.name}"`,
      });
      await emitFromAutomation(ctx, "task.status_changed", "task", task.id, {
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        toStatus: status.key,
        toCategory: status.category,
        assigneeMembershipId: task.assigneeMembershipId,
      });
      if (completing) {
        await emitFromAutomation(ctx, "task.completed", "task", task.id, {
          taskId: task.id,
          projectId: task.projectId,
          title: task.title,
          assigneeMembershipId: task.assigneeMembershipId,
        });
        for (const dep of await releasedDependents(ctx.tx, org, task.id)) {
          await emitFromAutomation(ctx, "task.unblocked", "task", dep.id, unblockedPayload(dep, task));
        }
      }
      return { type: action.type, taskId: task.id, status: status.key };
    }
    case "assign_task": {
      const taskId = (p.taskId as string | undefined) ?? (ctx.ev.entityType === "task" ? ctx.ev.entityId : null);
      const task = await taskInfo(ctx.tx, org, taskId);
      if (!task) throw new Error("O evento não está ligado a uma tarefa.");
      if (action.onlyIfUnassigned !== false && task.assigneeMembershipId) {
        return { type: action.type, taskId: task.id, skipped: "A tarefa já tem responsável." };
      }
      if (task.assigneeMembershipId === action.membershipId) {
        return { type: action.type, taskId: task.id, skipped: "Já é o responsável." };
      }
      const [m] = await membersByIds(ctx.tx, org, [action.membershipId]);
      if (!m || m.kind !== "internal") throw new Error("O responsável configurado não está ativo.");
      await ctx.tx
        .update(tasks)
        .set({ assigneeMembershipId: action.membershipId })
        .where(and(eq(tasks.organizationId, org), eq(tasks.id, task.id)));
      await ctx.tx.insert(auditLogs).values({
        organizationId: org,
        action: "assigned",
        entityType: "task",
        entityId: task.id,
        summary: `Responsável: ${m.name} (automação "${ctx.rule.name}")`,
      });
      await emitFromAutomation(ctx, "task.assigned", "task", task.id, {
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        assigneeMembershipId: action.membershipId,
        previousAssigneeMembershipId: task.assigneeMembershipId,
      });
      return { type: action.type, taskId: task.id, assigneeMembershipId: action.membershipId };
    }
    case "webhook": {
      const res = await postWebhook(
        action.url,
        {
          id: ctx.ev.id,
          event: ctx.ev.type,
          organizationId: org,
          entityType: ctx.ev.entityType,
          entityId: ctx.ev.entityId,
          createdAt: ctx.ev.createdAt,
          payload: p,
        },
        webhookSecret(org),
      );
      return { type: action.type, status: res.status };
    }
    default:
      throw new Error("Ação desconhecida.");
  }
}

/**
 * Executa as regras ativas cujo gatilho é o tipo do evento. Cada regra roda
 * num savepoint: se uma ação falhar, as alterações daquela regra são
 * desfeitas e a execução fica registrada como "failed", sem afetar as demais.
 */
export async function runAutomations(
  tx: Tx,
  ev: DomainEvent,
): Promise<{ ran: number; failed: number; skipped: number }> {
  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const summary = { ran: 0, failed: 0, skipped: 0 };
  if (payload.viaAutomation) return summary;
  const rules = await tx
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organizationId, ev.organizationId),
        eq(automationRules.trigger, ev.type),
        eq(automationRules.enabled, true),
      ),
    )
    .orderBy(asc(automationRules.createdAt));
  if (!rules.length) return summary;
  const slug = (await orgSlug(tx, ev.organizationId)) ?? "";

  for (const rule of rules) {
    const startedAt = new Date();
    if (!matchesConditions(rule.conditions ?? [], payload)) {
      await tx.insert(automationRuns).values({
        organizationId: ev.organizationId,
        ruleId: rule.id,
        eventId: ev.id,
        status: "skipped",
        startedAt,
        finishedAt: new Date(),
        result: { reason: "Condições não atendidas" },
      });
      summary.skipped++;
      continue;
    }
    const results: Record<string, unknown>[] = [];
    try {
      await tx.transaction(async (sp) => {
        for (const action of rule.actions ?? []) {
          results.push(await runAction({ tx: sp, ev, payload, rule, slug }, action));
        }
      });
      await tx.insert(automationRuns).values({
        organizationId: ev.organizationId,
        ruleId: rule.id,
        eventId: ev.id,
        status: "success",
        startedAt,
        finishedAt: new Date(),
        result: { actions: results },
      });
      summary.ran++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await tx.insert(automationRuns).values({
        organizationId: ev.organizationId,
        ruleId: rule.id,
        eventId: ev.id,
        status: "failed",
        startedAt,
        finishedAt: new Date(),
        error: message.slice(0, 1000),
        result: { actions: results },
      });
      summary.failed++;
    }
    await tx.update(automationRules).set({ lastRunAt: new Date() }).where(eq(automationRules.id, rule.id));
  }
  return summary;
}
