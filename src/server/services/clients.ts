import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  brandProfileInput,
  clientInput,
  clientListParams,
  clientMembersInput,
  contactInput,
  serviceInput,
} from "@/lib/validators/clients";
import {
  auditLogs,
  brandProfiles,
  clientContacts,
  clientMembers,
  clients,
  clientServices,
  memberships,
  projects,
  requests,
  user,
} from "@/server/db/schema";
import { assertCan, assertClientAccess, assertInternal, can, clientScope, type Scope } from "@/server/authz";
import { NotFoundError } from "@/server/errors";
import { diff, recordActivity } from "./activity";
import { assertActiveMembers } from "./members";

const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listClients(s: Scope, raw: z.input<typeof clientListParams>) {
  assertCan(s.actor, "clients.read");
  const p = clientListParams.parse(raw);
  const where = and(
    clientScope(s.actor),
    p.archived ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
    p.status ? eq(clients.status, p.status) : undefined,
    p.q ? or(ilike(clients.name, ESC(p.q)), ilike(clients.legalName, ESC(p.q)), ilike(clients.document, ESC(p.q))) : undefined,
  );

  const lead = s.db
    .select({
      clientId: clientMembers.clientId,
      name: user.name,
      image: user.image,
    })
    .from(clientMembers)
    .innerJoin(memberships, eq(memberships.id, clientMembers.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(clientMembers.role, "lead"))
    .as("lead");

  const [rows, [total]] = await Promise.all([
    s.db
      .select({
        id: clients.id,
        name: clients.name,
        industry: clients.industry,
        status: clients.status,
        email: clients.email,
        archivedAt: clients.archivedAt,
        createdAt: clients.createdAt,
        leadName: lead.name,
        leadImage: lead.image,
        activeProjects: sql<number>`(select count(*)::int from ${projects} where ${projects.clientId} = ${clients.id} and ${projects.archivedAt} is null and ${projects.completedAt} is null)`,
        openRequests: sql<number>`(select count(*)::int from ${requests} where ${requests.clientId} = ${clients.id} and ${requests.status} in ('submitted','triage','in_progress'))`,
      })
      .from(clients)
      .leftJoin(lead, eq(lead.clientId, clients.id))
      .where(where)
      .orderBy(asc(clients.name))
      .limit(p.pageSize)
      .offset((p.page - 1) * p.pageSize),
    s.db.select({ n: count() }).from(clients).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page: p.page, pageSize: p.pageSize };
}

/** Lista curta para seletores (respeita o escopo). */
export async function clientOptions(s: Scope) {
  return s.db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(clientScope(s.actor), isNull(clients.archivedAt)))
    .orderBy(asc(clients.name))
    .limit(500);
}

export async function getClient(s: Scope, id: string) {
  assertCan(s.actor, "clients.read");
  await assertClientAccess(s, id);
  const [client] = await s.db.select().from(clients).where(eq(clients.id, id));
  if (!client) throw new NotFoundError("Cliente não encontrado.");

  const internal = s.actor.kind === "internal";
  const [contacts, team, services, [brand]] = await Promise.all([
    internal
      ? s.db.select().from(clientContacts).where(eq(clientContacts.clientId, id)).orderBy(desc(clientContacts.isPrimary), asc(clientContacts.name))
      : Promise.resolve([]),
    s.db
      .select({
        membershipId: clientMembers.membershipId,
        role: clientMembers.role,
        name: user.name,
        email: user.email,
        image: user.image,
        jobTitle: memberships.jobTitle,
      })
      .from(clientMembers)
      .innerJoin(memberships, eq(memberships.id, clientMembers.membershipId))
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(clientMembers.clientId, id))
      .orderBy(asc(clientMembers.role), asc(user.name)),
    internal ? s.db.select().from(clientServices).where(eq(clientServices.clientId, id)).orderBy(asc(clientServices.name)) : Promise.resolve([]),
    s.db.select().from(brandProfiles).where(eq(brandProfiles.clientId, id)),
  ]);

  const showMoney = can(s.actor, "finance.read");
  return {
    client: internal ? client : { ...client, notesInternal: null, document: null },
    contacts,
    team,
    services: services.map((sv) => ({ ...sv, amountCents: showMoney ? sv.amountCents : null })),
    brand: brand ?? null,
  };
}

export async function createClient(s: Scope, raw: z.input<typeof clientInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const data = clientInput.parse(raw);
  await assertActiveMembers(s, [data.leadMembershipId]);

  const [row] = await s.db
    .insert(clients)
    .values({
      organizationId: s.actor.orgId,
      name: data.name,
      legalName: data.legalName,
      document: data.document,
      email: data.email,
      phone: data.phone,
      website: data.website,
      industry: data.industry,
      address: data.address,
      status: data.status,
      notesInternal: data.notesInternal,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: clients.id });
  const id = row!.id;

  await s.db.insert(brandProfiles).values({ clientId: id, organizationId: s.actor.orgId });
  const lead = data.leadMembershipId ?? s.actor.membershipId;
  await s.db.insert(clientMembers).values({ organizationId: s.actor.orgId, clientId: id, membershipId: lead, role: "lead" });

  await recordActivity(s, {
    action: "created",
    entityType: "client",
    entityId: id,
    summary: `Cliente ${data.name} cadastrado`,
    event: { payload: { clientId: id, name: data.name } },
  });
  return { id };
}

export async function updateClient(s: Scope, id: string, raw: z.input<typeof clientInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, id);
  const data = clientInput.parse(raw);
  const [before] = await s.db.select().from(clients).where(eq(clients.id, id));
  if (!before) throw new NotFoundError();

  const patch = {
    name: data.name,
    legalName: data.legalName,
    document: data.document,
    email: data.email,
    phone: data.phone,
    website: data.website,
    industry: data.industry,
    address: data.address,
    status: data.status,
    notesInternal: data.notesInternal,
  };
  const changes = diff(before, patch);
  await s.db.update(clients).set(patch).where(eq(clients.id, id));

  if (data.leadMembershipId) {
    await assertActiveMembers(s, [data.leadMembershipId]);
    await s.db
      .update(clientMembers)
      .set({ role: "member" })
      .where(and(eq(clientMembers.clientId, id), eq(clientMembers.role, "lead")));
    await s.db
      .insert(clientMembers)
      .values({ organizationId: s.actor.orgId, clientId: id, membershipId: data.leadMembershipId, role: "lead" })
      .onConflictDoUpdate({ target: [clientMembers.clientId, clientMembers.membershipId], set: { role: "lead" } });
  }

  if (Object.keys(changes).length) {
    await recordActivity(s, {
      action: changes.status ? "status_changed" : "updated",
      entityType: "client",
      entityId: id,
      summary: changes.status ? `Status do cliente alterado` : `Dados do cliente atualizados`,
      changes,
    });
  }
}

export async function setClientArchived(s: Scope, id: string, archived: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.archive");
  await assertClientAccess(s, id);
  await s.db
    .update(clients)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(clients.id, id));
  await recordActivity(s, {
    action: archived ? "archived" : "restored",
    entityType: "client",
    entityId: id,
    summary: archived ? "Cliente arquivado" : "Cliente reativado",
  });
}

/* Contatos ---------------------------------------------------------- */

export async function saveContact(s: Scope, raw: z.input<typeof contactInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const data = contactInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  if (data.isPrimary) {
    await s.db.update(clientContacts).set({ isPrimary: false }).where(eq(clientContacts.clientId, data.clientId));
  }
  const values = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    position: data.position,
    isPrimary: data.isPrimary,
    notes: data.notes,
  };
  let id = data.id;
  if (id) {
    const res = await s.db
      .update(clientContacts)
      .set(values)
      .where(and(eq(clientContacts.id, id), eq(clientContacts.clientId, data.clientId)))
      .returning({ id: clientContacts.id });
    if (!res.length) throw new NotFoundError("Contato não encontrado.");
  } else {
    const [row] = await s.db
      .insert(clientContacts)
      .values({ ...values, organizationId: s.actor.orgId, clientId: data.clientId })
      .returning({ id: clientContacts.id });
    id = row!.id;
  }
  await recordActivity(s, {
    action: data.id ? "contact_updated" : "contact_added",
    entityType: "client",
    entityId: data.clientId,
    summary: `${data.id ? "Contato atualizado" : "Contato adicionado"}: ${data.name}`,
    event: false,
  });
  return { id };
}

export async function deleteContact(s: Scope, clientId: string, contactId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, clientId);
  const [row] = await s.db
    .delete(clientContacts)
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
    .returning({ name: clientContacts.name });
  if (!row) throw new NotFoundError("Contato não encontrado.");
  await recordActivity(s, {
    action: "contact_removed",
    entityType: "client",
    entityId: clientId,
    summary: `Contato removido: ${row.name}`,
    event: false,
  });
}

/* Responsáveis internos -------------------------------------------- */

export async function setClientMembers(s: Scope, raw: z.input<typeof clientMembersInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const data = clientMembersInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  await assertActiveMembers(
    s,
    data.members.map((m) => m.membershipId),
  );
  await s.db.delete(clientMembers).where(eq(clientMembers.clientId, data.clientId));
  if (data.members.length) {
    await s.db.insert(clientMembers).values(
      data.members.map((m) => ({
        organizationId: s.actor.orgId,
        clientId: data.clientId,
        membershipId: m.membershipId,
        role: m.role,
      })),
    );
  }
  await recordActivity(s, {
    action: "team_updated",
    entityType: "client",
    entityId: data.clientId,
    summary: "Equipe responsável atualizada",
    metadata: { members: data.members.length },
    event: false,
  });
}

/* Serviços contratados --------------------------------------------- */

export async function saveService(s: Scope, raw: z.input<typeof serviceInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const data = serviceInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  const canMoney = can(s.actor, "finance.write");

  const values = {
    name: data.name,
    description: data.description,
    billingType: data.billingType,
    billingDay: data.billingDay ?? null,
    startsOn: data.startsOn,
    endsOn: data.endsOn,
    status: data.status,
    ...(canMoney && data.amount !== null ? { amountCents: data.amount } : {}),
  };

  let id = data.id;
  if (id) {
    const res = await s.db
      .update(clientServices)
      .set(values)
      .where(and(eq(clientServices.id, id), eq(clientServices.clientId, data.clientId)))
      .returning({ id: clientServices.id });
    if (!res.length) throw new NotFoundError("Serviço não encontrado.");
  } else {
    const [row] = await s.db
      .insert(clientServices)
      .values({ ...values, organizationId: s.actor.orgId, clientId: data.clientId })
      .returning({ id: clientServices.id });
    id = row!.id;
  }
  await recordActivity(s, {
    action: data.id ? "service_updated" : "service_added",
    entityType: "client",
    entityId: data.clientId,
    summary: `${data.id ? "Serviço atualizado" : "Serviço contratado"}: ${data.name}`,
    event: { type: "client.service_changed", payload: { serviceId: id } },
  });
  return { id };
}

export async function deleteService(s: Scope, clientId: string, serviceId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, clientId);
  const [row] = await s.db
    .delete(clientServices)
    .where(and(eq(clientServices.id, serviceId), eq(clientServices.clientId, clientId)))
    .returning({ name: clientServices.name });
  if (!row) throw new NotFoundError("Serviço não encontrado.");
  await recordActivity(s, {
    action: "service_removed",
    entityType: "client",
    entityId: clientId,
    summary: `Serviço removido: ${row.name}`,
    event: false,
  });
}

/* Marca -------------------------------------------------------------- */

export async function getBrandProfile(s: Scope, clientId: string) {
  assertCan(s.actor, "clients.read");
  await assertClientAccess(s, clientId);
  const [row] = await s.db.select().from(brandProfiles).where(eq(brandProfiles.clientId, clientId));
  return row ?? null;
}

export async function updateBrandProfile(s: Scope, raw: z.input<typeof brandProfileInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const data = brandProfileInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  const { clientId, ...values } = data;
  await s.db
    .insert(brandProfiles)
    .values({ clientId, organizationId: s.actor.orgId, ...values })
    .onConflictDoUpdate({ target: brandProfiles.clientId, set: values });
  await recordActivity(s, {
    action: "brand_updated",
    entityType: "client",
    entityId: clientId,
    summary: "Identidade da marca atualizada",
    event: false,
  });
}

/* Histórico ---------------------------------------------------------- */

export async function clientHistory(s: Scope, clientId: string, limit = 50) {
  assertCan(s.actor, "clients.read");
  await assertClientAccess(s, clientId);
  const relatedProjects = s.db.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId));
  const relatedRequests = s.db.select({ id: requests.id }).from(requests).where(eq(requests.clientId, clientId));
  return s.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
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
        or(
          and(eq(auditLogs.entityType, "client"), eq(auditLogs.entityId, clientId)),
          and(eq(auditLogs.entityType, "project"), inArray(auditLogs.entityId, relatedProjects)),
          and(eq(auditLogs.entityType, "request"), inArray(auditLogs.entityId, relatedRequests)),
        ),
        s.actor.kind === "client" ? eq(auditLogs.clientVisible, true) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
