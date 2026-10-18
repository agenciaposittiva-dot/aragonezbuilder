import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  clientAccess,
  clientMembers,
  memberships,
  organizations,
  projectMembers,
  projects,
  requests,
  roles,
  taskCollaborators,
  tasks,
  user,
} from "@/server/db/schema";

/*
 * Consultas de destinatários usadas pelo worker. Rodam com o bypass de RLS
 * (withSystem), portanto TODA consulta filtra explicitamente por organização.
 */

export type Recipient = { userId: string; email: string; name: string; kind: "internal" | "client" };

const activeMember = (orgId: string) => and(eq(memberships.organizationId, orgId), eq(memberships.status, "active"));

const recipientCols = { userId: user.id, email: user.email, name: user.name, kind: roles.kind };

export async function orgSlug(tx: Tx, orgId: string): Promise<string | null> {
  const [row] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
  return row?.slug ?? null;
}

/** Membros ativos por id de vínculo (somente desta organização). */
export async function membersByIds(tx: Tx, orgId: string, membershipIds: (string | null | undefined)[]) {
  const ids = [...new Set(membershipIds.filter((x): x is string => !!x))];
  if (!ids.length) return [] as Recipient[];
  return tx
    .select(recipientCols)
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(activeMember(orgId), inArray(memberships.id, ids)));
}

/** Membros internos ativos que possuem uma permissão. */
export async function internalMembersWithPermission(tx: Tx, orgId: string, permission: string) {
  return tx
    .select(recipientCols)
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(activeMember(orgId), eq(roles.kind, "internal"), sql`${permission} = any(${roles.permissions})`));
}

/** Membros internos ativos com determinados papéis (chave do papel). */
export async function membersWithRoles(tx: Tx, orgId: string, roleKeys: string[]) {
  if (!roleKeys.length) return [] as Recipient[];
  return tx
    .select(recipientCols)
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(activeMember(orgId), inArray(roles.key, roleKeys)));
}

/** Usuários de cliente (papel "client") com acesso a um cliente. */
export async function clientUsers(tx: Tx, orgId: string, clientId: string | null | undefined) {
  if (!clientId) return [] as Recipient[];
  return tx
    .select(recipientCols)
    .from(clientAccess)
    .innerJoin(memberships, eq(memberships.id, clientAccess.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(clientAccess.organizationId, orgId),
        eq(clientAccess.clientId, clientId),
        activeMember(orgId),
        eq(roles.kind, "client"),
      ),
    );
}

/** Equipe interna responsável pelo cliente. */
export async function clientTeam(tx: Tx, orgId: string, clientId: string | null | undefined) {
  if (!clientId) return [] as Recipient[];
  return tx
    .select(recipientCols)
    .from(clientMembers)
    .innerJoin(memberships, eq(memberships.id, clientMembers.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(clientMembers.organizationId, orgId), eq(clientMembers.clientId, clientId), activeMember(orgId)));
}

export async function projectInfo(tx: Tx, orgId: string, projectId: string | null | undefined) {
  if (!projectId) return null;
  const [row] = await tx
    .select({
      id: projects.id,
      name: projects.name,
      clientId: projects.clientId,
      ownerMembershipId: projects.ownerMembershipId,
    })
    .from(projects)
    .where(and(eq(projects.organizationId, orgId), eq(projects.id, projectId)));
  return row ?? null;
}

/** Membros da equipe do projeto que possuem uma permissão. */
export async function projectTeamWithPermission(tx: Tx, orgId: string, projectId: string, permission: string) {
  return tx
    .select(recipientCols)
    .from(projectMembers)
    .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(projectMembers.organizationId, orgId),
        eq(projectMembers.projectId, projectId),
        activeMember(orgId),
        sql`${permission} = any(${roles.permissions})`,
      ),
    );
}

export async function taskInfo(tx: Tx, orgId: string, taskId: string | null | undefined) {
  if (!taskId) return null;
  const [row] = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      assigneeMembershipId: tasks.assigneeMembershipId,
    })
    .from(tasks)
    .where(and(eq(tasks.organizationId, orgId), eq(tasks.id, taskId)));
  if (!row) return null;
  const collaborators = await tx
    .select({ membershipId: taskCollaborators.membershipId })
    .from(taskCollaborators)
    .where(and(eq(taskCollaborators.organizationId, orgId), eq(taskCollaborators.taskId, taskId)));
  return { ...row, collaboratorIds: collaborators.map((c) => c.membershipId) };
}

export async function requestInfo(tx: Tx, orgId: string, requestId: string | null | undefined) {
  if (!requestId) return null;
  const [row] = await tx
    .select({
      id: requests.id,
      number: requests.number,
      title: requests.title,
      clientId: requests.clientId,
      assigneeMembershipId: requests.assigneeMembershipId,
      createdByUserId: requests.createdByUserId,
    })
    .from(requests)
    .where(and(eq(requests.organizationId, orgId), eq(requests.id, requestId)));
  return row ?? null;
}

/** Usuário (id) por e-mail de um vínculo ativo — usado para "solicitante" de aprovações. */
export async function recipientByUserId(tx: Tx, orgId: string, userId: string | null | undefined) {
  if (!userId) return null;
  const [row] = await tx
    .select(recipientCols)
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(activeMember(orgId), eq(memberships.userId, userId)));
  return row ?? null;
}
