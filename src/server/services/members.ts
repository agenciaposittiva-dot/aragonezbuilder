import { and, asc, eq, inArray } from "drizzle-orm";
import { memberships, roles, user } from "@/server/db/schema";
import { assertInternal, type Scope } from "@/server/authz";
import { ValidationError } from "@/server/errors";

export type MemberOption = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  roleKey: string;
  roleName: string;
  kind: "internal" | "client";
  jobTitle: string | null;
  status: "active" | "suspended" | "removed";
};

/** Membros internos ativos (para atribuição de responsáveis e equipes). */
export async function listInternalMembers(s: Scope): Promise<MemberOption[]> {
  assertInternal(s.actor);
  return s.db
    .select({
      membershipId: memberships.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      roleKey: roles.key,
      roleName: roles.name,
      kind: roles.kind,
      jobTitle: memberships.jobTitle,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.status, "active"), eq(roles.kind, "internal")))
    .orderBy(asc(user.name));
}

/** Garante que os vínculos informados pertencem à organização e estão ativos. */
export async function assertActiveMembers(s: Scope, membershipIds: (string | null | undefined)[]) {
  const ids = [...new Set(membershipIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const rows = await s.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(inArray(memberships.id, ids), eq(memberships.status, "active")));
  if (rows.length !== ids.length) {
    throw new ValidationError("Um dos membros selecionados não está ativo na organização.");
  }
}

export async function getMembershipUserIds(s: Scope, membershipIds: string[]): Promise<Map<string, string>> {
  if (!membershipIds.length) return new Map();
  const rows = await s.db
    .select({ id: memberships.id, userId: memberships.userId })
    .from(memberships)
    .where(inArray(memberships.id, membershipIds));
  return new Map(rows.map((r) => [r.id, r.userId]));
}
