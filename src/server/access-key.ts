import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { memberships, organizations, roles } from "@/server/db/schema";
import { env } from "@/server/env";

/*
 * Chave de acesso para criar novas agências (ACESS_KEY / ACCESS_KEY). Evita que
 * qualquer pessoa crie organizações na sua instalação. A conta administradora
 * (ARAGONEZ_ADMIN) não precisa dela.
 */

export function isPlatformAdmin(email: string): boolean {
  return !!env.ARAGONEZ_ADMIN && env.ARAGONEZ_ADMIN.trim().toLowerCase() === email.trim().toLowerCase();
}

export function accessKeyMatches(given: string | undefined): boolean {
  if (!env.ACCESS_KEY) return true;
  const a = createHash("sha256")
    .update(given ?? "")
    .digest();
  const b = createHash("sha256").update(env.ACCESS_KEY).digest();
  return timingSafeEqual(a, b);
}

/** Agências ativas que a pessoa administra (papel da equipe com permissão de convidar e gerenciar membros). */
export async function listManagedAgencies(userId: string): Promise<{ slug: string; name: string }[]> {
  return withSystem((tx) =>
    tx
      .select({ slug: organizations.slug, name: organizations.name })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          isNull(organizations.deletedAt),
          eq(roles.kind, "internal"),
          sql`'members.manage' = any(${roles.permissions})`,
        ),
      )
      .orderBy(organizations.name),
  );
}

export async function managesAnyAgency(userId: string): Promise<boolean> {
  const [row] = await withSystem((tx) =>
    tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          isNull(organizations.deletedAt),
          eq(roles.kind, "internal"),
          sql`'members.manage' = any(${roles.permissions})`,
        ),
      )
      .limit(1),
  );
  return !!row;
}

/**
 * Quem pode criar uma agência nova (plataforma privada):
 *  - a conta administradora (ARAGONEZ_ADMIN): sempre, sem chave;
 *  - com ACCESS_KEY configurada: quem tiver a chave (regra que já existia);
 *  - sem ACCESS_KEY: só quem já administra uma agência.
 * Convidados (equipe sem administração ou clientes) não criam agências por conta própria.
 */
export async function agencyCreationAccess(userId: string, email: string): Promise<"open" | "key" | "denied"> {
  if (isPlatformAdmin(email)) return "open";
  if (env.ACCESS_KEY) return "key";
  return (await managesAnyAgency(userId)) ? "open" : "denied";
}
