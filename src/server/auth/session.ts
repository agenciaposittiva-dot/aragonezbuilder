import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Permission, RoleKind } from "@/lib/permissions";
import { resolveActor, type Actor } from "@/server/authz/actor";
import { auth } from "./index";

/** Sessão da requisição atual (memoizada durante a renderização). */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export const getActor = cache(async (orgSlug: string): Promise<Actor | null> => {
  const session = await getSession();
  if (!session) return null;
  return resolveActor(session.user.id, orgSlug);
});

/**
 * Garante sessão + vínculo ativo com a organização (para páginas).
 * Sem vínculo, responde 404 para não revelar a existência da organização.
 */
export async function requireActor(
  orgSlug: string,
  opts: { kind?: RoleKind; permission?: Permission } = {},
): Promise<Actor> {
  const session = await requireSession();
  const actor = await getActor(orgSlug);
  if (!actor || actor.userId !== session.user.id) notFound();
  if (opts.kind && actor.kind !== opts.kind) {
    redirect(actor.kind === "client" ? `/portal/${actor.orgSlug}` : `/w/${actor.orgSlug}`);
  }
  if (opts.permission && !actor.permissions.has(opts.permission)) notFound();
  return actor;
}
