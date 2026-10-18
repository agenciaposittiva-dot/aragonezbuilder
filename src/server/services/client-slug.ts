import { and, eq, like, ne } from "drizzle-orm";
import { slugify } from "@/lib/slug";
import { clients } from "@/server/db/schema";
import type { Tx } from "@/server/db";

/** Segmentos usados pelas rotas do portal: não podem ser endereço de cliente. */
export const RESERVED_CLIENT_SLUGS = new Set([
  "entrar",
  "ir",
  "approvals",
  "requests",
  "files",
  "projects",
  "brand",
  "account",
  "equipe",
  "team",
  "notificacoes",
  "notifications",
  "settings",
  "new",
  "api",
  "login",
  "logout",
]);

export const CLIENT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Gera um endereço único na organização a partir do nome (sufixo -2, -3… em caso de conflito). */
export async function uniqueClientSlug(tx: Tx, organizationId: string, name: string, excludeId?: string) {
  let base = slugify(name) || "cliente";
  if (RESERVED_CLIENT_SLUGS.has(base)) base = `${base}-cliente`;
  const taken = new Set(
    (
      await tx
        .select({ slug: clients.slug })
        .from(clients)
        .where(
          and(
            eq(clients.organizationId, organizationId),
            like(clients.slug, `${base}%`),
            excludeId ? ne(clients.id, excludeId) : undefined,
          ),
        )
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
