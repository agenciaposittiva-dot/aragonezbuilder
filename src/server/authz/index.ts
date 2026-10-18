import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Permission } from "@/lib/permissions";
import { withOrg, type Tx } from "@/server/db";
import { clientMembers, clients, files, projectMembers, projects, taskCollaborators, tasks } from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import type { Actor } from "./actor";

export type { Actor } from "./actor";

/** Contexto de execução de um serviço: transação já restrita à organização + ator. */
export type Scope = { db: Tx; actor: Actor };

/** Abre uma transação na organização do ator e executa o serviço. */
export function inOrg<T>(actor: Actor, fn: (s: Scope) => Promise<T>): Promise<T> {
  return withOrg(actor.orgId, (tx) => fn({ db: tx, actor }));
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function canAny(actor: Actor, ...permissions: Permission[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

export function assertCan(actor: Actor, ...permissions: Permission[]): void {
  for (const p of permissions) {
    if (!actor.permissions.has(p)) throw new ForbiddenError();
  }
}

export function assertInternal(actor: Actor): void {
  if (actor.kind !== "internal") throw new ForbiddenError();
}

const FALSE = sql`false`;

/* ------------------------------------------------------------------ */
/* Escopo de dados                                                     */
/* ------------------------------------------------------------------ */

/**
 * Condição SQL sobre `projects` que limita aos projetos visíveis para o ator.
 * `undefined` = sem restrição adicional (o RLS ainda limita à organização).
 */
export function projectScope(actor: Actor): SQL | undefined {
  if (actor.kind === "client") {
    return actor.clientIds.length ? inArray(projects.clientId, [...actor.clientIds]) : FALSE;
  }
  if (actor.dataAll) return undefined;
  return or(
    eq(projects.ownerMembershipId, actor.membershipId),
    sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.membershipId} = ${actor.membershipId})`,
    sql`exists (select 1 from ${tasks} where ${tasks.projectId} = ${projects.id} and (${tasks.assigneeMembershipId} = ${actor.membershipId} or exists (select 1 from ${taskCollaborators} where ${taskCollaborators.taskId} = ${tasks.id} and ${taskCollaborators.membershipId} = ${actor.membershipId})))`,
  );
}

/** Condição SQL sobre `clients`. */
export function clientScope(actor: Actor): SQL | undefined {
  if (actor.kind === "client") {
    return actor.clientIds.length ? inArray(clients.id, [...actor.clientIds]) : FALSE;
  }
  if (actor.dataAll) return undefined;
  const visibleProjects = projectScope(actor);
  return or(
    sql`exists (select 1 from ${clientMembers} where ${clientMembers.clientId} = ${clients.id} and ${clientMembers.membershipId} = ${actor.membershipId})`,
    sql`exists (select 1 from ${projects} where ${projects.clientId} = ${clients.id} and ${visibleProjects ?? sql`true`})`,
  );
}

/** Condição SQL sobre `tasks`. Clientes não veem tarefas internas. */
export function taskScope(actor: Actor): SQL | undefined {
  if (actor.kind === "client") return FALSE;
  if (actor.dataAll) return undefined;
  const visibleProjects = projectScope(actor);
  return sql`exists (select 1 from ${projects} where ${projects.id} = ${tasks.projectId} and ${visibleProjects ?? sql`true`})`;
}

/** Condição SQL sobre `files`. Clientes veem apenas o que foi compartilhado explicitamente. */
export function fileScope(actor: Actor): SQL | undefined {
  const notDeleted = isNull(files.deletedAt);
  if (actor.kind === "client") {
    if (!actor.clientIds.length) return FALSE;
    return and(notDeleted, eq(files.sharedWithClient, true), inArray(files.clientId, [...actor.clientIds]));
  }
  if (actor.dataAll) return notDeleted;
  const visibleProjects = projectScope(actor);
  const visibleClients = clientScope(actor);
  return and(
    notDeleted,
    or(
      eq(files.createdByUserId, actor.userId),
      sql`(${files.projectId} is not null and exists (select 1 from ${projects} where ${projects.id} = ${files.projectId} and ${visibleProjects ?? sql`true`}))`,
      sql`(${files.projectId} is null and ${files.clientId} is not null and exists (select 1 from ${clients} where ${clients.id} = ${files.clientId} and ${visibleClients ?? sql`true`}))`,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Verificações de registro único                                      */
/* ------------------------------------------------------------------ */

export async function assertClientAccess(s: Scope, clientId: string) {
  const [row] = await s.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), clientScope(s.actor)))
    .limit(1);
  if (!row) throw new NotFoundError("Cliente não encontrado.");
}

export async function assertProjectAccess(s: Scope, projectId: string) {
  const [row] = await s.db
    .select({ id: projects.id, clientId: projects.clientId })
    .from(projects)
    .where(and(eq(projects.id, projectId), projectScope(s.actor)))
    .limit(1);
  if (!row) throw new NotFoundError("Projeto não encontrado.");
  return row;
}

export async function assertTaskAccess(s: Scope, taskId: string) {
  const [row] = await s.db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), taskScope(s.actor)))
    .limit(1);
  if (!row) throw new NotFoundError("Tarefa não encontrada.");
  return row;
}

export async function assertFileAccess(s: Scope, fileId: string) {
  const [row] = await s.db
    .select({ id: files.id, clientId: files.clientId, projectId: files.projectId })
    .from(files)
    .where(and(eq(files.id, fileId), fileScope(s.actor)))
    .limit(1);
  if (!row) throw new NotFoundError("Arquivo não encontrado.");
  return row;
}
