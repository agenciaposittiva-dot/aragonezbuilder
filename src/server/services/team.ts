import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { todayISO } from "@/lib/format";
import { clientAccessInput, memberStatusInput, memberUpdateInput } from "@/lib/validators/team";
import { clientAccess, clients, memberships, roles, tasks, user } from "@/server/db/schema";
import { eachInSequence } from "@/server/db/sequence";
import { assertCan, assertInternal, can, type Scope } from "@/server/authz";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { diff, recordActivity } from "./activity";

/** Membros (ativos e suspensos; removidos só quando pedido). */
export async function listMembers(s: Scope, opts: { includeRemoved?: boolean } = {}) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.read");
  const showCost = can(s.actor, "costs.read");
  const rows = await s.db
    .select({
      membershipId: memberships.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      kind: roles.kind,
      status: memberships.status,
      jobTitle: memberships.jobTitle,
      specialties: memberships.specialties,
      weeklyCapacityMinutes: memberships.weeklyCapacityMinutes,
      hourlyCostCents: memberships.hourlyCostCents,
      createdAt: memberships.createdAt,
      openTasks: sql<number>`(select count(*)::int from ${tasks} t where t.assignee_membership_id = ${memberships.id} and t.completed_at is null and t.archived_at is null)`,
      overdueTasks: sql<number>`(select count(*)::int from ${tasks} t where t.assignee_membership_id = ${memberships.id} and t.completed_at is null and t.archived_at is null and t.due_date < current_date)`,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(opts.includeRemoved ? undefined : ne(memberships.status, "removed"))
    .orderBy(asc(roles.kind), asc(user.name));

  const clientMemberIds = rows.filter((r) => r.kind === "client").map((r) => r.membershipId);
  const access = clientMemberIds.length
    ? await s.db
        .select({ membershipId: clientAccess.membershipId, clientId: clients.id, clientName: clients.name })
        .from(clientAccess)
        .innerJoin(clients, eq(clients.id, clientAccess.clientId))
        .where(inArray(clientAccess.membershipId, clientMemberIds))
    : [];

  return rows.map((r) => ({
    ...r,
    hourlyCostCents: showCost ? r.hourlyCostCents : null,
    clients: access
      .filter((a) => a.membershipId === r.membershipId)
      .map((a) => ({ id: a.clientId, name: a.clientName })),
  }));
}

export type MemberRow = Awaited<ReturnType<typeof listMembers>>[number];

async function getMembershipWithRole(s: Scope, membershipId: string) {
  const [row] = await s.db
    .select({ membership: memberships, role: roles, name: user.name })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.id, membershipId));
  if (!row) throw new NotFoundError("Membro não encontrado.");
  return row;
}

async function activeOwnerCount(s: Scope) {
  const [row] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(roles.key, "owner"), eq(memberships.status, "active")));
  return row?.n ?? 0;
}

const isOwner = (s: Scope) => s.actor.roleKey === "owner";

export async function updateMember(s: Scope, raw: z.input<typeof memberUpdateInput>) {
  assertInternal(s.actor);
  const data = memberUpdateInput.parse(raw);
  const present = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
  const target = await getMembershipWithRole(s, data.membershipId);
  const self = target.membership.id === s.actor.membershipId;
  const manage = can(s.actor, "members.manage");
  if (!manage && !self) throw new ForbiddenError();

  const patch: Partial<typeof memberships.$inferInsert> = {};
  if (present("jobTitle")) patch.jobTitle = data.jobTitle ?? null;
  if (present("specialties") && data.specialties) patch.specialties = [...new Set(data.specialties)];
  if (present("weeklyCapacityHours") && data.weeklyCapacityHours !== undefined) {
    if (!manage) throw new ForbiddenError("Só a gestão da equipe pode alterar a capacidade.");
    patch.weeklyCapacityMinutes = Math.round(data.weeklyCapacityHours * 60);
  }
  if (present("hourlyCost")) {
    if (!manage || !can(s.actor, "costs.read"))
      throw new ForbiddenError("Você não tem permissão para alterar custos internos.");
    patch.hourlyCostCents = data.hourlyCost ?? null;
  }

  let roleChange: { from: string; to: string } | null = null;
  if (data.roleId && data.roleId !== target.membership.roleId) {
    if (!manage) throw new ForbiddenError("Você não tem permissão para alterar papéis.");
    const [newRole] = await s.db.select().from(roles).where(eq(roles.id, data.roleId));
    if (!newRole) throw new ValidationError("Papel inválido.");
    if (newRole.kind !== target.role.kind) {
      throw new ValidationError(
        "Não é possível transformar um membro da equipe em usuário de cliente (ou o contrário). Convide a pessoa com o papel certo.",
      );
    }
    const touchesOwner = newRole.key === "owner" || target.role.key === "owner";
    if (touchesOwner && !isOwner(s))
      throw new ForbiddenError("Só um proprietário pode conceder ou retirar o papel de proprietário.");
    if (
      target.role.key === "owner" &&
      newRole.key !== "owner" &&
      target.membership.status === "active" &&
      (await activeOwnerCount(s)) <= 1
    ) {
      throw new ValidationError("A organização precisa de pelo menos um proprietário ativo.");
    }
    patch.roleId = newRole.id;
    roleChange = { from: target.role.name, to: newRole.name };
  }

  const changes = diff(target.membership, patch);
  if (!Object.keys(changes).length) return;
  await s.db.update(memberships).set(patch).where(eq(memberships.id, data.membershipId));
  await recordActivity(s, {
    action: roleChange ? "role_changed" : "updated",
    entityType: "membership",
    entityId: data.membershipId,
    summary: roleChange
      ? `Papel de ${target.name}: ${roleChange.from} → ${roleChange.to}`
      : `Perfil de ${target.name} atualizado`,
    changes: roleChange
      ? { role: roleChange }
      : Object.fromEntries(Object.entries(changes).filter(([k]) => k !== "hourlyCostCents")),
    event: false,
  });
}

export async function setMemberStatus(s: Scope, raw: z.input<typeof memberStatusInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.manage");
  const data = memberStatusInput.parse(raw);
  const target = await getMembershipWithRole(s, data.membershipId);
  if (target.membership.id === s.actor.membershipId) {
    throw new ValidationError("Você não pode alterar o seu próprio acesso. Peça a outro administrador.");
  }
  if (target.membership.status === data.status) return;
  if (target.role.key === "owner") {
    if (!isOwner(s)) throw new ForbiddenError("Só um proprietário pode suspender ou remover outro proprietário.");
    if (data.status !== "active" && target.membership.status === "active" && (await activeOwnerCount(s)) <= 1) {
      throw new ValidationError("A organização precisa de pelo menos um proprietário ativo.");
    }
  }
  await s.db.update(memberships).set({ status: data.status }).where(eq(memberships.id, data.membershipId));
  const label = { active: "reativado", suspended: "suspenso", removed: "removido" }[data.status];
  await recordActivity(s, {
    action: `status_${data.status}`,
    entityType: "membership",
    entityId: data.membershipId,
    summary: `${target.name} ${label}`,
    event: false,
  });
}

/** Clientes que um usuário de cliente pode acessar. */
export async function setClientAccess(s: Scope, raw: z.input<typeof clientAccessInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.manage");
  const data = clientAccessInput.parse(raw);
  const target = await getMembershipWithRole(s, data.membershipId);
  if (target.role.kind !== "client") throw new ValidationError("Apenas usuários de cliente têm acesso por cliente.");
  const ids = [...new Set(data.clientIds)];
  const found = await s.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(inArray(clients.id, ids), isNull(clients.archivedAt), isNull(clients.deletedAt)));
  if (found.length !== ids.length) throw new ValidationError("Um dos clientes selecionados é inválido.");
  await s.db.delete(clientAccess).where(eq(clientAccess.membershipId, data.membershipId));
  await eachInSequence(ids, (clientId) =>
    s.db.insert(clientAccess).values({ organizationId: s.actor.orgId, clientId, membershipId: data.membershipId }),
  );
  await recordActivity(s, {
    action: "client_access_updated",
    entityType: "membership",
    entityId: data.membershipId,
    summary: `Acesso de ${target.name} atualizado (${ids.length} cliente(s))`,
    event: false,
  });
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Carga de trabalho dos próximos 7 dias.
 * Carga = soma das estimativas das tarefas abertas com prazo nos próximos 7 dias ÷ capacidade semanal.
 */
export async function workload(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.read");
  const today = todayISO();
  const until = addDays(today, 6);
  const rows = await s.db
    .select({
      membershipId: memberships.id,
      name: user.name,
      image: user.image,
      jobTitle: memberships.jobTitle,
      roleName: roles.name,
      capacity: memberships.weeklyCapacityMinutes,
      plannedMinutes: sql<number>`coalesce((select sum(t.estimate_minutes) from ${tasks} t where t.assignee_membership_id = ${memberships.id} and t.completed_at is null and t.archived_at is null and t.due_date between ${today}::date and ${until}::date), 0)::int`,
      dueSoon: sql<number>`(select count(*)::int from ${tasks} t where t.assignee_membership_id = ${memberships.id} and t.completed_at is null and t.archived_at is null and t.due_date between ${today}::date and ${until}::date)`,
      withoutEstimate: sql<number>`(select count(*)::int from ${tasks} t where t.assignee_membership_id = ${memberships.id} and t.completed_at is null and t.archived_at is null and t.due_date between ${today}::date and ${until}::date and t.estimate_minutes is null)`,
      overdue: sql<number>`(select count(*)::int from ${tasks} t where t.assignee_membership_id = ${memberships.id} and t.completed_at is null and t.archived_at is null and t.due_date < ${today}::date)`,
      open: sql<number>`(select count(*)::int from ${tasks} t where t.assignee_membership_id = ${memberships.id} and t.completed_at is null and t.archived_at is null)`,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.status, "active"), eq(roles.kind, "internal")))
    .orderBy(asc(user.name));
  return {
    from: today,
    to: until,
    rows: rows.map((r) => ({ ...r, load: r.capacity > 0 ? r.plannedMinutes / r.capacity : null })),
  };
}

export async function listRoleOptions(s: Scope) {
  assertInternal(s.actor);
  return s.db
    .select({ id: roles.id, key: roles.key, name: roles.name, kind: roles.kind, description: roles.description })
    .from(roles)
    .orderBy(asc(roles.kind), asc(roles.name));
}
