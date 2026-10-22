import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { clientCategoryInput, clientCategoryMoveInput, clientCategoryOrderInput } from "@/lib/validators/clients";
import { clientCategories, clients } from "@/server/db/schema";
import { assertCan, assertClientAccess, assertInternal, clientScope, type Scope } from "@/server/authz";
import { inSequence } from "@/server/db/sequence";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

/*
 * Categorias de clientes (menu lateral e página de Clientes). A categoria é só
 * uma referência no cliente: mover um cliente não duplica nada e não mexe em
 * projetos, arquivos ou histórico. Excluir uma categoria deixa os clientes dela
 * "sem categoria". Contagens respeitam o escopo de clientes de quem consulta.
 */

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Clientes visíveis e ativos (não arquivados nem na lixeira) — o que o menu mostra. */
const visibleClients = (s: Scope) => and(clientScope(s.actor), isNull(clients.archivedAt));

export async function listClientCategories(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.read");
  const [categories, counts] = await inSequence(
    () =>
      s.db
        .select({ id: clientCategories.id, name: clientCategories.name, color: clientCategories.color })
        .from(clientCategories)
        .orderBy(asc(clientCategories.position), asc(clientCategories.createdAt)),
    () =>
      s.db
        .select({ categoryId: clients.categoryId, n: sql<number>`count(*)::int` })
        .from(clients)
        .where(visibleClients(s))
        .groupBy(clients.categoryId),
  );
  const byCategory = new Map(counts.map((c) => [c.categoryId, c.n]));
  return {
    categories: categories.map((c) => ({ ...c, count: byCategory.get(c.id) ?? 0 })),
    uncategorized: byCategory.get(null) ?? 0,
  };
}

export type ClientCategoryRow = Awaited<ReturnType<typeof listClientCategories>>["categories"][number];

/**
 * Árvore do menu lateral: categorias com os clientes (nome e logo) de cada uma.
 * Limitada para não pesar o layout; o restante fica na página de Clientes.
 */
export async function clientCategoryTree(s: Scope, limit = 300) {
  const { categories, uncategorized } = await listClientCategories(s);
  const rows = await s.db
    .select({ id: clients.id, name: clients.name, categoryId: clients.categoryId })
    .from(clients)
    .where(visibleClients(s))
    .orderBy(asc(sql`lower(${clients.name})`))
    .limit(limit);
  return { categories, uncategorized, clients: rows };
}

async function assertCategory(s: Scope, id: string) {
  const [row] = await s.db
    .select({ id: clientCategories.id, name: clientCategories.name })
    .from(clientCategories)
    .where(eq(clientCategories.id, id));
  if (!row) throw new NotFoundError("Categoria não encontrada.");
  return row;
}

export async function saveClientCategory(s: Scope, raw: z.input<typeof clientCategoryInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const data = clientCategoryInput.parse(raw);
  try {
    // Savepoint: um nome repetido não pode abortar a transação inteira da ação.
    const result = await s.db.transaction(async (tx) => {
      if (data.id) {
        const res = await tx
          .update(clientCategories)
          .set({ name: data.name, color: data.color })
          .where(eq(clientCategories.id, data.id))
          .returning({ id: clientCategories.id });
        if (!res.length) throw new NotFoundError("Categoria não encontrada.");
        return { id: data.id, created: false };
      }
      const [last] = await tx
        .select({ max: sql<number | null>`max(${clientCategories.position})` })
        .from(clientCategories);
      const [row] = await tx
        .insert(clientCategories)
        .values({
          organizationId: s.actor.orgId,
          name: data.name,
          color: data.color,
          position: (last?.max ?? -1) + 1,
        })
        .returning({ id: clientCategories.id });
      return { id: row!.id, created: true };
    });
    await recordActivity(s, {
      action: result.created ? "created" : "updated",
      entityType: "client_category",
      entityId: result.id,
      summary: result.created ? `Categoria de clientes criada: ${data.name}` : `Categoria de clientes: ${data.name}`,
      event: false,
    });
    return { id: result.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("Já existe uma categoria com esse nome.", { name: ["Nome em uso"] });
    }
    throw err;
  }
}

/** Nova ordem das categorias (lista completa de ids, na ordem desejada). */
export async function reorderClientCategories(s: Scope, raw: z.input<typeof clientCategoryOrderInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const { ids } = clientCategoryOrderInput.parse(raw);
  const unique = [...new Set(ids)];
  const found = await s.db
    .select({ id: clientCategories.id })
    .from(clientCategories)
    .where(inArray(clientCategories.id, unique));
  if (found.length !== unique.length) throw new ValidationError("Uma das categorias não existe mais.");
  for (const [position, id] of unique.entries()) {
    await s.db.update(clientCategories).set({ position }).where(eq(clientCategories.id, id));
  }
}

/** Exclui a categoria; os clientes dela ficam "sem categoria" (nenhum dado de cliente é apagado). */
export async function deleteClientCategory(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const cat = await assertCategory(s, id);
  const moved = await s.db
    .update(clients)
    .set({ categoryId: null })
    .where(eq(clients.categoryId, id))
    .returning({ id: clients.id });
  await s.db.delete(clientCategories).where(eq(clientCategories.id, id));
  await recordActivity(s, {
    action: "deleted",
    entityType: "client_category",
    entityId: id,
    summary: `Categoria de clientes excluída: ${cat.name}${moved.length ? ` (${moved.length} cliente(s) ficaram sem categoria)` : ""}`,
    event: false,
  });
  return { moved: moved.length };
}

/** Move um cliente de categoria (ou tira de todas). */
export async function setClientCategory(s: Scope, raw: z.input<typeof clientCategoryMoveInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const data = clientCategoryMoveInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  const [client] = await s.db
    .select({ id: clients.id, name: clients.name, categoryId: clients.categoryId })
    .from(clients)
    .where(eq(clients.id, data.clientId));
  if (!client) throw new NotFoundError("Cliente não encontrado.");
  if (client.categoryId === data.categoryId) return;
  const cat = data.categoryId ? await assertCategory(s, data.categoryId) : null;
  await s.db.update(clients).set({ categoryId: data.categoryId }).where(eq(clients.id, data.clientId));
  await recordActivity(s, {
    action: "updated",
    entityType: "client",
    entityId: data.clientId,
    summary: cat ? `Cliente movido para a categoria ${cat.name}` : "Cliente ficou sem categoria",
    changes: { categoryId: { from: client.categoryId, to: data.categoryId } },
    event: false,
  });
}

/** Valida a categoria informada no cadastro/edição do cliente. */
export async function resolveCategoryId(s: Scope, categoryId: string | null | undefined) {
  if (!categoryId) return null;
  return (await assertCategory(s, categoryId)).id;
}
