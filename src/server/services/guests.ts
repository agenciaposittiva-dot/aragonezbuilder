import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { uuid } from "@/lib/validators/common";
import { INVITE_VALIDITY, invitationInput } from "@/lib/validators/team";
import { assertCan, assertClientAccess, assertInternal, can, type Scope } from "@/server/authz";
import { clientAccess, clientPortalSettings, invitations, memberships, roles, session, user } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { inviteEmailStates, inviteKey, issueInvitation, reissueInvitation, type InvitationIssued } from "./invitations";

/*
 * Convidados de um cliente (usuários externos com acesso ao portal daquele
 * cliente). A equipe da agência gerencia tudo; o administrador do cliente só
 * convida colegas para o próprio cliente, quando a agência permite.
 */

type Mode = "internal" | "client";

async function guestInvitesAllowed(s: Scope, clientId: string) {
  const [row] = await s.db
    .select({ allow: clientPortalSettings.allowGuestInvites })
    .from(clientPortalSettings)
    .where(eq(clientPortalSettings.clientId, clientId));
  return row?.allow ?? false;
}

/** Quem pode gerenciar os convidados deste cliente (e de que forma). */
async function assertGuestManager(s: Scope, clientId: string): Promise<Mode> {
  if (s.actor.kind === "internal") {
    assertCan(s.actor, "members.manage");
    await assertClientAccess(s, clientId);
    return "internal";
  }
  if (!can(s.actor, "portal.invite") || !s.actor.clientIds.includes(clientId)) throw new ForbiddenError();
  if (!(await guestInvitesAllowed(s, clientId))) {
    throw new ForbiddenError("A agência não habilitou convites feitos pelo cliente.");
  }
  return "client";
}

async function assertGuestReader(s: Scope, clientId: string): Promise<Mode> {
  if (s.actor.kind === "internal") {
    assertCan(s.actor, "members.read");
    await assertClientAccess(s, clientId);
    return "internal";
  }
  return assertGuestManager(s, clientId);
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export async function listClientGuests(s: Scope, clientId: string) {
  const mode = await assertGuestReader(s, clientId);
  const members = await s.db
    .select({
      membershipId: memberships.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      status: memberships.status,
      joinedAt: clientAccess.createdAt,
      lastAccessAt: sql<Date | null>`(select max(${session.updatedAt}) from ${session} where ${session.userId} = ${user.id})`,
    })
    .from(clientAccess)
    .innerJoin(memberships, eq(memberships.id, clientAccess.membershipId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(clientAccess.clientId, clientId), eq(roles.kind, "client"), ne(memberships.status, "removed")))
    .orderBy(user.name);

  const inviteRows = await s.db
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      roleName: roles.name,
      clientIds: invitations.clientIds,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      invitedBy: user.name,
    })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .leftJoin(user, eq(user.id, invitations.invitedByUserId))
    .where(and(eq(roles.kind, "client"), sql`${clientId}::uuid = any(${invitations.clientIds})`))
    .orderBy(desc(invitations.createdAt))
    .limit(50);
  const states = await inviteEmailStates(s, inviteRows);
  const now = Date.now();
  const invites = inviteRows.map((r) => {
    const status: InvitationStatus = r.acceptedAt
      ? "accepted"
      : r.revokedAt
        ? "revoked"
        : r.expiresAt.getTime() < now
          ? "expired"
          : "pending";
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      roleName: r.roleName,
      status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      invitedBy: r.invitedBy,
      emailState: states.get(inviteKey(r)) ?? ("not_configured" as const),
      // O administrador do cliente só mexe nos convites feitos só para o próprio cliente.
      manageable:
        status === "pending" && (mode === "internal" || (r.clientIds.length === 1 && r.clientIds[0] === clientId)),
    };
  });

  return {
    mode,
    members: members.map((m) => ({ ...m, isSelf: m.userId === s.actor.userId })),
    invites,
  };
}

export type ClientGuests = Awaited<ReturnType<typeof listClientGuests>>;

/** Papéis que podem ser dados a convidados (sempre do tipo cliente). */
export async function guestRoleOptions(s: Scope) {
  return s.db
    .select({ id: roles.id, key: roles.key, name: roles.name, description: roles.description })
    .from(roles)
    .where(eq(roles.kind, "client"))
    .orderBy(roles.name);
}

export const guestInviteInput = invitationInput.omit({ clientIds: true }).extend({ clientId: uuid });

export async function inviteGuest(
  s: Scope,
  raw: z.input<typeof guestInviteInput>,
): Promise<InvitationIssued | { granted: true }> {
  const data = guestInviteInput.parse(raw);
  const mode = await assertGuestManager(s, data.clientId);
  const [role] = await s.db.select().from(roles).where(eq(roles.id, data.roleId));
  // Convidados só recebem papéis do tipo cliente: nenhuma permissão interna da agência.
  if (!role || role.kind !== "client") {
    throw new ValidationError("Escolha um papel de cliente.", { roleId: ["Selecione um papel de cliente"] });
  }

  const [existing] = await s.db
    .select({ id: memberships.id, status: memberships.status, kind: roles.kind })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(sql`lower(${user.email}) = ${data.email}`);
  if (existing?.status === "active") {
    if (existing.kind !== "client") throw new ConflictError("Esta pessoa faz parte da equipe da agência.");
    if (mode === "client") {
      throw new ConflictError("Esta pessoa já tem acesso à área do cliente. Peça à agência para incluí-la.");
    }
    // Já é convidada de outro cliente: a equipe apenas inclui o acesso a este cliente.
    await s.db
      .insert(clientAccess)
      .values({ organizationId: s.actor.orgId, clientId: data.clientId, membershipId: existing.id })
      .onConflictDoNothing();
    await recordActivity(s, {
      action: "client_access_granted",
      entityType: "membership",
      entityId: existing.id,
      summary: `Acesso ao cliente incluído para ${data.email}`,
      event: false,
    });
    return { granted: true };
  }

  return issueInvitation(s, {
    email: data.email,
    name: data.name,
    role,
    clientIds: [data.clientId],
    validityDays: data.validityDays,
  });
}

async function loadGuestInvitation(s: Scope, clientId: string, invitationId: string, mode: Mode) {
  const [inv] = await s.db
    .select({ id: invitations.id, email: invitations.email, clientIds: invitations.clientIds })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .where(and(eq(invitations.id, invitationId), eq(roles.kind, "client")));
  if (!inv || !inv.clientIds.includes(clientId)) throw new NotFoundError("Convite não encontrado.");
  if (mode === "client" && (inv.clientIds.length !== 1 || inv.clientIds[0] !== clientId)) {
    throw new NotFoundError("Convite não encontrado.");
  }
  return inv;
}

export async function resendGuestInvitation(
  s: Scope,
  clientId: string,
  invitationId: string,
  validityDays: number = INVITE_VALIDITY.default,
) {
  const mode = await assertGuestManager(s, clientId);
  await loadGuestInvitation(s, clientId, invitationId, mode);
  return reissueInvitation(s, invitationId, validityDays);
}

export async function revokeGuestInvitation(s: Scope, clientId: string, invitationId: string) {
  const mode = await assertGuestManager(s, clientId);
  const inv = await loadGuestInvitation(s, clientId, invitationId, mode);
  const [row] = await s.db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.id, invitationId),
        sql`${invitations.acceptedAt} is null`,
        sql`${invitations.revokedAt} is null`,
      ),
    )
    .returning({ id: invitations.id });
  if (!row) throw new NotFoundError("Convite não encontrado ou já utilizado.");
  await recordActivity(s, {
    action: "revoked",
    entityType: "invitation",
    entityId: invitationId,
    summary: `Convite para ${inv.email} revogado`,
    event: false,
  });
}

async function loadGuest(s: Scope, clientId: string, membershipId: string) {
  const [row] = await s.db
    .select({ id: memberships.id, userId: memberships.userId, name: user.name, kind: roles.kind })
    .from(clientAccess)
    .innerJoin(memberships, eq(memberships.id, clientAccess.membershipId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(clientAccess.clientId, clientId), eq(clientAccess.membershipId, membershipId)));
  if (!row || row.kind !== "client") throw new NotFoundError("Convidado não encontrado.");
  return row;
}

/** Troca o papel do convidado (vale para todos os clientes que a pessoa acessa). */
export async function changeGuestRole(s: Scope, clientId: string, membershipId: string, roleId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.manage");
  await assertClientAccess(s, clientId);
  const guest = await loadGuest(s, clientId, membershipId);
  const [role] = await s.db.select().from(roles).where(eq(roles.id, roleId));
  if (!role || role.kind !== "client") throw new ValidationError("Escolha um papel de cliente.");
  await s.db.update(memberships).set({ roleId: role.id }).where(eq(memberships.id, membershipId));
  await recordActivity(s, {
    action: "role_changed",
    entityType: "membership",
    entityId: membershipId,
    summary: `${guest.name} agora é ${role.name}`,
    event: false,
  });
}

/**
 * Remove o acesso do convidado a este cliente. Sem nenhum cliente restante, o
 * vínculo é suspenso. O acesso cai na próxima requisição (o ator é resolvido a
 * cada pedido a partir do banco).
 */
export async function removeGuestAccess(s: Scope, clientId: string, membershipId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.manage");
  await assertClientAccess(s, clientId);
  const guest = await loadGuest(s, clientId, membershipId);
  await s.db
    .delete(clientAccess)
    .where(and(eq(clientAccess.clientId, clientId), eq(clientAccess.membershipId, membershipId)));
  const remaining = await s.db
    .select({ clientId: clientAccess.clientId })
    .from(clientAccess)
    .where(eq(clientAccess.membershipId, membershipId));
  if (!remaining.length) {
    await s.db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, membershipId));
  }
  await recordActivity(s, {
    action: "client_access_removed",
    entityType: "membership",
    entityId: membershipId,
    summary: `Acesso de ${guest.name} ao cliente removido${remaining.length ? "" : " (vínculo suspenso)"}`,
    event: false,
  });
  return { suspended: !remaining.length };
}
