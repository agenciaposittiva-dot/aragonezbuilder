import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  convertRequestInput,
  REQUEST_STATUS_LABEL,
  REQUEST_TRANSITIONS,
  requestInput,
  requestListParams,
  requestUpdateInput,
  type RequestStatus,
} from "@/lib/validators/requests";
import {
  auditLogs,
  briefingTemplates,
  clients,
  files,
  memberships,
  projects,
  requests,
  tasks,
  user,
} from "@/server/db/schema";
import {
  assertCan,
  assertClientAccess,
  assertInternal,
  assertProjectAccess,
  assertRequestAccess,
  can,
  clientScope,
  type Scope,
} from "@/server/authz";
import { inSequence } from "@/server/db/sequence";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { getTemplate, validateBriefing } from "./briefings";
import { nextCounter } from "./counters";
import { assertActiveMembers } from "./members";
import { createProject } from "./projects";
import { getDefaultStatus } from "./workflow";

const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const creator = alias(user, "creator");
const assigneeUser = alias(user, "assignee_user");

const OPEN: RequestStatus[] = ["submitted", "triage", "in_progress"];

export async function listRequests(s: Scope, raw: z.input<typeof requestListParams>) {
  assertCan(s.actor, "requests.read");
  const p = requestListParams.parse(raw);
  const where = and(
    clientScope(s.actor),
    // Rascunhos de clientes só aparecem para quem os criou.
    or(sql`${requests.status} <> 'draft'`, eq(requests.createdByUserId, s.actor.userId)),
    p.status ? eq(requests.status, p.status) : undefined,
    p.open ? inArray(requests.status, OPEN) : undefined,
    p.clientId ? eq(requests.clientId, p.clientId) : undefined,
    p.category ? eq(requests.category, p.category) : undefined,
    p.assigneeId ? eq(requests.assigneeMembershipId, p.assigneeId) : undefined,
    p.q
      ? or(
          ilike(requests.title, ESC(p.q)),
          Number.isInteger(Number(p.q.replace("#", "")))
            ? eq(requests.number, Number(p.q.replace("#", "")))
            : undefined,
        )
      : undefined,
  );
  const [rows, [total]] = await inSequence(
    () =>
      s.db
        .select({
          id: requests.id,
          number: requests.number,
          title: requests.title,
          category: requests.category,
          status: requests.status,
          priority: requests.priority,
          desiredDueDate: requests.desiredDueDate,
          createdAt: requests.createdAt,
          submittedAt: requests.submittedAt,
          clientId: clients.id,
          clientName: clients.name,
          projectId: requests.projectId,
          assigneeName: assigneeUser.name,
          assigneeImage: assigneeUser.image,
          createdByName: creator.name,
        })
        .from(requests)
        .innerJoin(clients, eq(clients.id, requests.clientId))
        .leftJoin(memberships, eq(memberships.id, requests.assigneeMembershipId))
        .leftJoin(assigneeUser, eq(assigneeUser.id, memberships.userId))
        .leftJoin(creator, eq(creator.id, requests.createdByUserId))
        .where(where)
        .orderBy(desc(requests.createdAt))
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize),
    () => s.db.select({ n: count() }).from(requests).innerJoin(clients, eq(clients.id, requests.clientId)).where(where),
  );
  return { rows, total: total?.n ?? 0, page: p.page, pageSize: p.pageSize };
}

export type RequestListRow = Awaited<ReturnType<typeof listRequests>>["rows"][number];

export async function requestStatusCounts(s: Scope, clientId?: string) {
  const rows = await s.db
    .select({ status: requests.status, n: sql<number>`count(*)::int` })
    .from(requests)
    .innerJoin(clients, eq(clients.id, requests.clientId))
    .where(
      and(
        clientScope(s.actor),
        clientId ? eq(requests.clientId, clientId) : undefined,
        sql`${requests.status} <> 'draft'`,
      ),
    )
    .groupBy(requests.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<RequestStatus, number>>;
}

export async function getRequest(s: Scope, id: string) {
  assertCan(s.actor, "requests.read");
  await assertRequestAccess(s, id);
  const [row] = await s.db
    .select({
      request: requests,
      clientName: clients.name,
      templateName: briefingTemplates.name,
      templateFields: briefingTemplates.fields,
      projectName: projects.name,
      assigneeName: assigneeUser.name,
      assigneeImage: assigneeUser.image,
      createdByName: creator.name,
    })
    .from(requests)
    .innerJoin(clients, eq(clients.id, requests.clientId))
    .leftJoin(briefingTemplates, eq(briefingTemplates.id, requests.templateId))
    .leftJoin(projects, eq(projects.id, requests.projectId))
    .leftJoin(memberships, eq(memberships.id, requests.assigneeMembershipId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, memberships.userId))
    .leftJoin(creator, eq(creator.id, requests.createdByUserId))
    .where(eq(requests.id, id));
  if (!row) throw new NotFoundError("Solicitação não encontrada.");
  if (row.request.status === "draft" && row.request.createdByUserId !== s.actor.userId && s.actor.kind === "client") {
    throw new NotFoundError("Solicitação não encontrada.");
  }
  return row;
}

export type RequestDetail = Awaited<ReturnType<typeof getRequest>>;

async function resolveBriefing(s: Scope, templateId: string | null, answers: Record<string, unknown>) {
  if (!templateId) return { template: null, briefing: {} };
  const template = await getTemplate(s, templateId);
  return { template, briefing: validateBriefing(template.fields, answers) };
}

function assertCanCreateFor(s: Scope, clientId: string) {
  assertCan(s.actor, "requests.write");
  if (s.actor.kind === "client") {
    if (!s.actor.clientIds.includes(clientId))
      throw new ForbiddenError("Você só pode abrir solicitações para a sua empresa.");
    if (!s.actor.settings.portal.allowRequestCreation)
      throw new ForbiddenError("A agência não habilitou novas solicitações pelo portal.");
  }
}

export async function createRequest(s: Scope, raw: z.input<typeof requestInput>) {
  const data = requestInput.parse(raw);
  assertCanCreateFor(s, data.clientId);
  await assertClientAccess(s, data.clientId);
  const { template, briefing } = await resolveBriefing(s, data.templateId, data.briefing);
  if (template && !template.isActive) throw new ValidationError("Este modelo de briefing está desativado.");

  const number = await nextCounter(s, "request");
  const status: RequestStatus = data.draft ? "draft" : "submitted";
  const [row] = await s.db
    .insert(requests)
    .values({
      organizationId: s.actor.orgId,
      number,
      clientId: data.clientId,
      templateId: data.templateId,
      title: data.title,
      category: template?.category ?? data.category,
      objective: data.objective,
      description: data.description,
      audience: data.audience,
      channel: data.channel,
      format: data.format,
      piecesCount: data.piecesCount ?? null,
      desiredDueDate: data.desiredDueDate,
      priority: data.priority,
      status,
      briefing,
      references: data.references,
      copyText: data.copyText,
      createdByUserId: s.actor.userId,
      submittedAt: data.draft ? null : new Date(),
    })
    .returning({ id: requests.id });
  const id = row!.id;

  await recordActivity(s, {
    action: data.draft ? "draft_created" : "created",
    entityType: "request",
    entityId: id,
    summary: data.draft ? `Rascunho #${number} criado` : `Solicitação #${number} recebida: ${data.title}`,
    clientVisible: true,
    event: data.draft
      ? false
      : {
          type: "request.created",
          payload: {
            requestId: id,
            clientId: data.clientId,
            number,
            title: data.title,
            category: template?.category ?? data.category,
            priority: data.priority,
            createdByKind: s.actor.kind,
          },
        },
  });
  return { id, number };
}

/** Edição: equipe com `requests.write`; o cliente autor só enquanto não entrou em produção. */
async function assertCanEdit(s: Scope, id: string) {
  const access = await assertRequestAccess(s, id);
  const [req] = await s.db.select().from(requests).where(eq(requests.id, id));
  if (!req) throw new NotFoundError();
  assertCan(s.actor, "requests.write");
  if (s.actor.kind === "client") {
    if (req.createdByUserId !== s.actor.userId) throw new ForbiddenError("Só quem abriu a solicitação pode editá-la.");
    if (!["draft", "submitted"].includes(req.status)) {
      throw new ForbiddenError("A solicitação já está com a agência. Use os comentários para pedir alterações.");
    }
  }
  return { req, access };
}

export async function updateRequest(s: Scope, raw: z.input<typeof requestUpdateInput>) {
  const data = requestUpdateInput.parse(raw);
  const { req } = await assertCanEdit(s, data.id);
  const { template, briefing } = await resolveBriefing(s, data.templateId ?? req.templateId, data.briefing);
  await s.db
    .update(requests)
    .set({
      templateId: data.templateId ?? req.templateId,
      title: data.title,
      category: template?.category ?? data.category,
      objective: data.objective,
      description: data.description,
      audience: data.audience,
      channel: data.channel,
      format: data.format,
      piecesCount: data.piecesCount ?? null,
      desiredDueDate: data.desiredDueDate,
      priority: data.priority,
      briefing,
      references: data.references,
      copyText: data.copyText,
    })
    .where(eq(requests.id, data.id));
  await recordActivity(s, {
    action: "updated",
    entityType: "request",
    entityId: data.id,
    summary: `Solicitação #${req.number} atualizada`,
    clientVisible: true,
    event: false,
  });
}

export async function submitRequest(s: Scope, id: string) {
  const { req } = await assertCanEdit(s, id);
  if (req.status !== "draft") throw new ValidationError("A solicitação já foi enviada.");
  if (req.templateId) {
    const template = await getTemplate(s, req.templateId);
    validateBriefing(template.fields, req.briefing);
  }
  await s.db.update(requests).set({ status: "submitted", submittedAt: new Date() }).where(eq(requests.id, id));
  await recordActivity(s, {
    action: "submitted",
    entityType: "request",
    entityId: id,
    summary: `Solicitação #${req.number} enviada`,
    clientVisible: true,
    event: {
      type: "request.created",
      payload: {
        requestId: id,
        clientId: req.clientId,
        number: req.number,
        title: req.title,
        category: req.category,
        priority: req.priority,
        createdByKind: s.actor.kind,
      },
    },
  });
}

/** Triagem: mudança de status conforme as transições permitidas. */
export async function changeRequestStatus(s: Scope, id: string, to: RequestStatus, reason?: string | null) {
  await assertRequestAccess(s, id);
  const [req] = await s.db.select().from(requests).where(eq(requests.id, id));
  if (!req) throw new NotFoundError();

  const clientCancelling = s.actor.kind === "client" && to === "cancelled";
  if (clientCancelling) {
    if (req.createdByUserId !== s.actor.userId || !["draft", "submitted"].includes(req.status)) {
      throw new ForbiddenError("Só é possível cancelar solicitações que ainda não entraram em triagem.");
    }
  } else {
    assertInternal(s.actor);
    assertCan(s.actor, "requests.triage");
  }
  if (req.status === to) return;
  if (!REQUEST_TRANSITIONS[req.status].includes(to)) {
    throw new ValidationError(
      `Transição não permitida: ${REQUEST_STATUS_LABEL[req.status]} → ${REQUEST_STATUS_LABEL[to]}.`,
    );
  }
  const text = reason?.trim() || null;
  if (to === "rejected" && !text)
    throw new ValidationError("Informe o motivo da recusa.", { reason: ["Informe o motivo"] });

  await s.db
    .update(requests)
    .set({ status: to, rejectionReason: to === "rejected" ? text : req.rejectionReason })
    .where(eq(requests.id, id));
  await recordActivity(s, {
    action: "status_changed",
    entityType: "request",
    entityId: id,
    summary: `Status: ${REQUEST_STATUS_LABEL[req.status]} → ${REQUEST_STATUS_LABEL[to]}${to === "rejected" && text ? ` (${text})` : ""}`,
    changes: { status: { from: REQUEST_STATUS_LABEL[req.status], to: REQUEST_STATUS_LABEL[to] } },
    clientVisible: true,
    event: {
      type: "request.status_changed",
      payload: {
        requestId: id,
        clientId: req.clientId,
        number: req.number,
        title: req.title,
        fromStatus: req.status,
        toStatus: to,
      },
    },
  });
}

export async function assignRequest(s: Scope, id: string, membershipId: string | null) {
  assertInternal(s.actor);
  assertCan(s.actor, "requests.triage");
  await assertRequestAccess(s, id);
  await assertActiveMembers(s, [membershipId]);
  const [req] = await s.db.select().from(requests).where(eq(requests.id, id));
  if (!req) throw new NotFoundError();
  if (req.assigneeMembershipId === membershipId) return;
  await s.db.update(requests).set({ assigneeMembershipId: membershipId }).where(eq(requests.id, id));
  await recordActivity(s, {
    action: "assigned",
    entityType: "request",
    entityId: id,
    summary: membershipId ? "Responsável definido" : "Responsável removido",
    changes: { assigneeMembershipId: { from: req.assigneeMembershipId, to: membershipId } },
    event: {
      type: "request.assigned",
      payload: {
        requestId: id,
        clientId: req.clientId,
        number: req.number,
        title: req.title,
        assigneeMembershipId: membershipId,
      },
    },
  });
}

/**
 * Converte a solicitação em projeto (novo ou existente) numa única transação:
 * cria o projeto (se for o caso), a tarefa inicial de produção, vincula
 * anexos ao projeto e coloca a solicitação em produção.
 */
export async function convertRequest(s: Scope, raw: z.input<typeof convertRequestInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "requests.triage");
  const data = convertRequestInput.parse(raw);
  await assertRequestAccess(s, data.requestId);
  const [req] = await s.db.select().from(requests).where(eq(requests.id, data.requestId));
  if (!req) throw new NotFoundError();
  if (req.projectId) throw new ValidationError("Esta solicitação já está vinculada a um projeto.");
  if (["rejected", "cancelled", "delivered", "draft"].includes(req.status)) {
    throw new ValidationError(
      `Não é possível converter uma solicitação ${REQUEST_STATUS_LABEL[req.status].toLowerCase()}.`,
    );
  }

  let projectId: string;
  if (data.mode === "existing") {
    if (!data.projectId) throw new ValidationError("Escolha o projeto.", { projectId: ["Escolha o projeto"] });
    const p = await assertProjectAccess(s, data.projectId);
    if (p.clientId !== req.clientId) throw new ValidationError("O projeto escolhido é de outro cliente.");
    assertCan(s.actor, "tasks.write");
    projectId = p.id;
  } else {
    const description = [req.description, req.objective ? `Objetivo: ${req.objective}` : null]
      .filter(Boolean)
      .join("\n\n");
    const created = await createProject(s, {
      clientId: req.clientId,
      name: data.projectName?.trim() || req.title,
      description: description || null,
      objective: req.objective,
      ownerMembershipId: data.ownerMembershipId ?? req.assigneeMembershipId ?? s.actor.membershipId,
      priority: req.priority,
      dueDate: data.dueDate ?? req.desiredDueDate,
    });
    projectId = created.id;
  }

  const status = await getDefaultStatus(s, "task");
  const [{ max } = { max: 0 }] = await s.db
    .select({ max: sql<number>`coalesce(max(${tasks.position}), 0)` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.statusId, status.id)));
  const assignee = req.assigneeMembershipId ?? data.ownerMembershipId ?? s.actor.membershipId;
  const title = `Produção: ${req.title}`.slice(0, 200);
  const dueDate = data.dueDate ?? req.desiredDueDate;
  const [task] = await s.db
    .insert(tasks)
    .values({
      organizationId: s.actor.orgId,
      projectId,
      requestId: req.id,
      title,
      description: req.description,
      statusId: status.id,
      priority: req.priority,
      assigneeMembershipId: assignee,
      dueDate,
      position: Number(max) + 1024,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: tasks.id });

  await s.db
    .update(files)
    .set({ projectId })
    .where(and(eq(files.requestId, req.id), isNull(files.projectId)));
  await s.db.update(requests).set({ projectId, status: "in_progress" }).where(eq(requests.id, req.id));

  await recordActivity(s, {
    action: "created",
    entityType: "task",
    entityId: task!.id,
    summary: `Tarefa criada a partir da solicitação #${req.number}`,
    event: {
      type: "task.created",
      payload: {
        taskId: task!.id,
        projectId,
        clientId: req.clientId,
        title,
        assigneeMembershipId: assignee,
        priority: req.priority,
        dueDate,
      },
    },
  });
  await recordActivity(s, {
    action: "converted",
    entityType: "request",
    entityId: req.id,
    summary: `Solicitação #${req.number} em produção`,
    clientVisible: true,
    event: { type: "request.converted", payload: { requestId: req.id, clientId: req.clientId, projectId } },
  });
  return { projectId, taskId: task!.id };
}

export function canTriage(s: Scope) {
  return s.actor.kind === "internal" && can(s.actor, "requests.triage");
}

export async function requestHistory(s: Scope, id: string, limit = 60) {
  await assertRequestAccess(s, id);
  return s.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      summary: auditLogs.summary,
      changes: auditLogs.changes,
      createdAt: auditLogs.createdAt,
      actorName: user.name,
      actorImage: user.image,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorUserId))
    .where(
      and(
        eq(auditLogs.entityType, "request"),
        eq(auditLogs.entityId, id),
        s.actor.kind === "client" ? eq(auditLogs.clientVisible, true) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
