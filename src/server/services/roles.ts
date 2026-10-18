import { and, asc, count, eq, ne } from "drizzle-orm";
import type { z } from "zod";
import { sanitizePermissions, SYSTEM_ROLES } from "@/lib/permissions";
import { slugify } from "@/lib/slug";
import { roleInput } from "@/lib/validators/settings";
import { memberships, roles } from "@/server/db/schema";
import { assertCan, type Scope } from "@/server/authz";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { diff, recordActivity } from "./activity";

export async function listRolesWithCounts(s: Scope) {
  assertCan(s.actor, "members.read");
  const counts = s.db
    .select({ roleId: memberships.roleId, n: count().as("n") })
    .from(memberships)
    .where(ne(memberships.status, "removed"))
    .groupBy(memberships.roleId)
    .as("counts");
  return s.db
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      kind: roles.kind,
      permissions: roles.permissions,
      isSystem: roles.isSystem,
      members: counts.n,
    })
    .from(roles)
    .leftJoin(counts, eq(counts.roleId, roles.id))
    .orderBy(asc(roles.kind), asc(roles.isSystem), asc(roles.name));
}

/**
 * Cria ou edita um papel. O papel "Proprietário" é imutável (sempre com
 * acesso total) para que a organização nunca perca o controle.
 */
export async function saveRole(s: Scope, raw: z.input<typeof roleInput>) {
  assertCan(s.actor, "roles.manage");
  const data = roleInput.parse(raw);
  if (data.id) {
    const [before] = await s.db.select().from(roles).where(eq(roles.id, data.id));
    if (!before) throw new NotFoundError("Papel não encontrado.");
    if (before.key === "owner") throw new ForbiddenError("O papel Proprietário não pode ser alterado.");
    const permissions = sanitizePermissions(before.kind, data.permissions);
    // Quem edita não pode remover de si mesmo a capacidade de gerenciar papéis.
    if (before.id === s.actor.roleId && !permissions.includes("roles.manage")) {
      throw new ConflictError("Você não pode remover do seu próprio papel a permissão de gerenciar papéis.");
    }
    const patch = { name: data.name, description: data.description, permissions };
    const changes = diff(before, patch, ["name", "description"]);
    const added = permissions.filter((p) => !before.permissions.includes(p));
    const removed = before.permissions.filter((p) => !permissions.includes(p as never));
    await s.db.update(roles).set(patch).where(eq(roles.id, data.id));
    await recordActivity(s, {
      action: "role_updated",
      entityType: "role",
      entityId: data.id,
      summary: `Papel "${data.name}" atualizado`,
      changes,
      metadata: { added, removed },
      event: false,
    });
    return { id: data.id };
  }

  const permissions = sanitizePermissions(data.kind, data.permissions);
  const base = slugify(data.name).replace(/-/g, "_") || "papel";
  const key = `custom_${base}_${Date.now().toString(36)}`;
  const [row] = await s.db
    .insert(roles)
    .values({
      organizationId: s.actor.orgId,
      key,
      name: data.name,
      description: data.description,
      kind: data.kind,
      permissions,
      isSystem: false,
    })
    .returning({ id: roles.id });
  await recordActivity(s, {
    action: "role_created",
    entityType: "role",
    entityId: row!.id,
    summary: `Papel "${data.name}" criado`,
    event: false,
  });
  return { id: row!.id };
}

export async function deleteRole(s: Scope, id: string) {
  assertCan(s.actor, "roles.manage");
  const [role] = await s.db.select().from(roles).where(eq(roles.id, id));
  if (!role) throw new NotFoundError("Papel não encontrado.");
  if (role.isSystem) throw new ForbiddenError("Papéis padrão não podem ser excluídos.");
  const [inUse] = await s.db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.roleId, id), ne(memberships.status, "removed")));
  if ((inUse?.n ?? 0) > 0) throw new ConflictError("Há pessoas com este papel. Altere o papel delas antes de excluir.");
  await s.db.delete(roles).where(eq(roles.id, id));
  await recordActivity(s, {
    action: "role_deleted",
    entityType: "role",
    entityId: id,
    summary: `Papel "${role.name}" excluído`,
    event: false,
  });
}

/** Restaura as permissões padrão de um papel de sistema. */
export async function resetRole(s: Scope, id: string) {
  assertCan(s.actor, "roles.manage");
  const [role] = await s.db.select().from(roles).where(eq(roles.id, id));
  if (!role) throw new NotFoundError("Papel não encontrado.");
  const def = SYSTEM_ROLES.find((r) => r.key === role.key);
  if (!def) throw new ConflictError("Só papéis padrão podem ser restaurados.");
  await s.db.update(roles).set({ permissions: def.permissions }).where(eq(roles.id, id));
  await recordActivity(s, {
    action: "role_reset",
    entityType: "role",
    entityId: id,
    summary: `Permissões padrão restauradas: ${role.name}`,
    event: false,
  });
}
