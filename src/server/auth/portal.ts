import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Permission } from "@/lib/permissions";
import { inOrg } from "@/server/authz";
import type { Actor } from "@/server/authz/actor";
import { clients } from "@/server/db/schema";
import { getActor, getSession } from "./session";

export type PortalContext = {
  /** Ator restrito ao cliente deste portal: todas as consultas ficam limitadas a ele. */
  actor: Actor;
  client: { id: string; slug: string; name: string };
  /** Base dos links do portal, ex.: /portal/agencia/cliente */
  base: string;
  /** O convidado tem acesso a outros clientes (mostra a troca de espaço). */
  multiClient: boolean;
  /** Logotipo cadastrado em Marca (usado quando o portal não define um próprio). */
  clientLogoFileId: string | null;
};

/**
 * Restringe um ator de cliente a um único cliente. Só reduz o acesso: um
 * cliente fora da lista do ator nunca é adicionado.
 */
export function narrowActorToClient(actor: Actor, clientId: string): Actor | null {
  if (actor.kind !== "client" || !actor.clientIds.includes(clientId)) return null;
  return { ...actor, clientIds: [clientId] };
}

const loadPortal = cache(async (orgSlug: string, clientSlug: string): Promise<PortalContext> => {
  const entrar = `/portal/${encodeURIComponent(orgSlug)}/${encodeURIComponent(clientSlug)}/entrar`;
  const session = await getSession();
  if (!session) redirect(entrar);
  const actor = await getActor(orgSlug);
  // Sem vínculo com a organização ou sem acesso a este cliente: a mesma resposta,
  // sem revelar se o cliente existe ou quais dados ele tem.
  if (!actor || actor.userId !== session.user.id) redirect(`${entrar}?negado=1`);
  if (actor.kind !== "client") redirect(`/w/${actor.orgSlug}`);
  if (!actor.permissions.has("portal.access") || !actor.clientIds.length) redirect(`${entrar}?negado=1`);
  const [client] = await inOrg(actor, (s) =>
    s.db
      .select({ id: clients.id, slug: clients.slug, name: clients.name, logoFileId: clients.logoFileId })
      .from(clients)
      .where(and(eq(clients.slug, clientSlug), inArray(clients.id, [...actor.clientIds]), isNull(clients.archivedAt))),
  );
  const narrowed = client ? narrowActorToClient(actor, client.id) : null;
  if (!client || !narrowed) redirect(`${entrar}?negado=1`);
  return {
    actor: narrowed,
    client: { id: client.id, slug: client.slug, name: client.name },
    base: `/portal/${actor.orgSlug}/${client.slug}`,
    multiClient: actor.clientIds.length > 1,
    clientLogoFileId: client.logoFileId,
  };
});

/** Para páginas do portal: sessão + vínculo + acesso ao cliente do endereço (+ permissão). */
export async function requirePortal(
  orgSlug: string,
  clientSlug: string,
  opts: { permission?: Permission | Permission[] } = {},
): Promise<PortalContext> {
  const ctx = await loadPortal(orgSlug, clientSlug);
  if (opts.permission) {
    const needed = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
    if (!needed.some((p) => ctx.actor.permissions.has(p))) notFound();
  }
  return ctx;
}
