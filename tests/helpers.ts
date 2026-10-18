import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import type { SystemRoleKey } from "@/lib/permissions";
import { inOrg, type Scope } from "@/server/authz";
import { resolveActor, type Actor } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import { clientAccess, memberships, roles, user } from "@/server/db/schema";
import { createOrganization } from "@/server/services/organizations";

/** Limpa todas as tabelas do banco de testes (como dono, ignorando RLS). */
export async function resetDb() {
  const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length) {
      await client.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
    }
  } finally {
    await client.end();
  }
}

export async function createUser(name: string, email = `${randomUUID().slice(0, 8)}@teste.dev`) {
  const id = randomUUID();
  await withSystem((tx) => tx.insert(user).values({ id, name, email, emailVerified: true }));
  return { id, name, email };
}

/** Cria uma organização com proprietário e devolve o ator do proprietário. */
export async function createOrgWithOwner(orgName: string, ownerName = "Dono") {
  const owner = await createUser(ownerName);
  const org = await createOrganization(owner.id, { name: orgName });
  const actor = await resolveActor(owner.id, org.slug);
  if (!actor) throw new Error("ator não resolvido");
  return { org, owner, actor };
}

/** Adiciona um membro com um papel de sistema e devolve o ator dele. */
export async function addMember(
  orgSlug: string,
  orgId: string,
  roleKey: SystemRoleKey,
  opts: { name?: string; clientIds?: string[] } = {},
): Promise<Actor> {
  const u = await createUser(opts.name ?? roleKey);
  await withSystem(async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(eq(roles.organizationId, orgId))
      .then((rs) => rs.filter((r) => r.key === roleKey));
    if (!role) throw new Error(`papel ${roleKey} não encontrado`);
    const [m] = await tx
      .insert(memberships)
      .values({ organizationId: orgId, userId: u.id, roleId: role.id })
      .returning();
    for (const clientId of opts.clientIds ?? []) {
      await tx.insert(clientAccess).values({ organizationId: orgId, clientId, membershipId: m!.id });
    }
  });
  const actor = await resolveActor(u.id, orgSlug);
  if (!actor) throw new Error("ator não resolvido");
  return actor;
}

export function as<T>(actor: Actor, fn: (s: Scope) => Promise<T>) {
  return inOrg(actor, fn);
}
