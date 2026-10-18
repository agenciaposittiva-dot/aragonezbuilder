import { and, eq } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { clientAccess, memberships, organizations, roles, user } from "@/server/db/schema";
import { parseOrgSettings, type OrgSettings } from "@/lib/org-settings";
import { sanitizePermissions, type Permission, type RoleKind } from "@/lib/permissions";

/**
 * Quem está agindo, em qual organização e com quais permissões.
 * É resolvido no servidor a cada requisição a partir da sessão.
 */
export type Actor = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  orgId: string;
  orgSlug: string;
  orgName: string;
  orgLogoUrl: string | null;
  settings: OrgSettings;
  membershipId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  kind: RoleKind;
  permissions: ReadonlySet<Permission>;
  /** Acesso a todos os clientes/projetos (permissão `data.all`, apenas internos). */
  dataAll: boolean;
  /** Clientes acessíveis por um usuário de cliente. */
  clientIds: readonly string[];
};

/** Resolve o ator para (usuário, slug da organização). Retorna null sem vínculo ativo. */
export async function resolveActor(userId: string, orgSlug: string): Promise<Actor | null> {
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        user,
        org: organizations,
        membership: memberships,
        role: roles,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(
        and(eq(memberships.userId, userId), eq(organizations.slug, orgSlug), eq(memberships.status, "active")),
      )
      .limit(1);
    if (!row) return null;

    const permissions = new Set(sanitizePermissions(row.role.kind, row.role.permissions));
    let clientIds: string[] = [];
    if (row.role.kind === "client") {
      const access = await tx
        .select({ clientId: clientAccess.clientId })
        .from(clientAccess)
        .where(eq(clientAccess.membershipId, row.membership.id));
      clientIds = access.map((a) => a.clientId);
    }

    return {
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      image: row.user.image,
      orgId: row.org.id,
      orgSlug: row.org.slug,
      orgName: row.org.name,
      orgLogoUrl: row.org.logoUrl,
      settings: parseOrgSettings(row.org.settings),
      membershipId: row.membership.id,
      roleId: row.role.id,
      roleKey: row.role.key,
      roleName: row.role.name,
      kind: row.role.kind,
      permissions,
      dataAll: row.role.kind === "internal" && permissions.has("data.all"),
      clientIds,
    } satisfies Actor;
  });
}

export type UserOrganization = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  roleName: string;
  kind: RoleKind;
};

/** Organizações em que o usuário tem vínculo ativo (para o seletor de organização). */
export async function listUserOrganizations(userId: string): Promise<UserOrganization[]> {
  return withSystem((tx) =>
    tx
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        logoUrl: organizations.logoUrl,
        roleName: roles.name,
        kind: roles.kind,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(organizations.name),
  );
}
