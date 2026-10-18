import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Permission } from "@/lib/permissions";
import { withOrg, type Tx } from "@/server/db";
import {
  clientMembers,
  clients,
  files,
  projectMembers,
  projects,
  requests,
  taskCollaborators,
  tasks,
} from "@/server/db/schema";
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

/*
 * Lixeira: clientes, projetos e artes excluídos ficam com `deleted_at`
 * preenchido até serem apagados de vez. Os escopos abaixo os escondem de
 * todas as consultas; quando um cliente vai para a lixeira, os projetos dele
 * vão junto (mesma data), então "projeto ativo" basta para tarefas e arquivos.
 */
const projectAlive = isNull(projects.deletedAt);
const clientAlive = isNull(clients.deletedAt);

/** Arquivo cujo projeto/cliente não está na lixeira. */
const fileOwnerAlive = sql`(${files.projectId} is null or exists (select 1 from ${projects} where ${projects.id} = ${files.projectId} and ${projects.deletedAt} is null)) and (${files.clientId} is null or exists (select 1 from ${clients} where ${clients.id} = ${files.clientId} and ${clients.deletedAt} is null))`;

/**
 * Condição SQL sobre `projects` que limita aos projetos visíveis para o ator.
 * Projetos na lixeira nunca entram (o RLS ainda limita à organização).
 */
export function projectScope(actor: Actor): SQL | undefined {
  if (actor.kind === "client") {
    // Convidados só veem projetos marcados como visíveis no portal.
    return actor.clientIds.length
      ? and(projectAlive, inArray(projects.clientId, [...actor.clientIds]), eq(projects.portalVisible, true))
      : FALSE;
  }
  if (actor.dataAll) return projectAlive;
  return and(
    projectAlive,
    or(
      eq(projects.ownerMembershipId, actor.membershipId),
      sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.membershipId} = ${actor.membershipId})`,
      sql`exists (select 1 from ${tasks} where ${tasks.projectId} = ${projects.id} and (${tasks.assigneeMembershipId} = ${actor.membershipId} or exists (select 1 from ${taskCollaborators} where ${taskCollaborators.taskId} = ${tasks.id} and ${taskCollaborators.membershipId} = ${actor.membershipId})))`,
    ),
  );
}

/** Condição SQL sobre `clients`. */
export function clientScope(actor: Actor): SQL | undefined {
  if (actor.kind === "client") {
    return actor.clientIds.length ? and(clientAlive, inArray(clients.id, [...actor.clientIds])) : FALSE;
  }
  if (actor.dataAll) return clientAlive;
  const visibleProjects = projectScope(actor);
  return and(
    clientAlive,
    or(
      sql`exists (select 1 from ${clientMembers} where ${clientMembers.clientId} = ${clients.id} and ${clientMembers.membershipId} = ${actor.membershipId})`,
      sql`exists (select 1 from ${projects} where ${projects.clientId} = ${clients.id} and ${visibleProjects ?? sql`true`})`,
    ),
  );
}

/** Condição SQL sobre `tasks`. Clientes não veem tarefas internas. */
export function taskScope(actor: Actor): SQL | undefined {
  if (actor.kind === "client") return FALSE;
  const visibleProjects = projectScope(actor) ?? projectAlive;
  // Tarefas na lixeira também saem do escopo (detalhe, comentários, anexos).
  return and(
    isNull(tasks.deletedAt),
    sql`exists (select 1 from ${projects} where ${projects.id} = ${tasks.projectId} and ${visibleProjects})`,
  );
}

/**
 * Filtro extra sobre `requests` para usuários de cliente: rascunhos só de quem
 * os criou e, sem `requests.read` (ex.: papel Solicitante), apenas as
 * solicitações abertas pela própria pessoa. Para a equipe, sem restrição extra.
 */
export function clientRequestFilter(actor: Actor): SQL | undefined {
  if (actor.kind !== "client") return undefined;
  const own = eq(requests.createdByUserId, actor.userId);
  if (!actor.permissions.has("requests.read")) return own;
  return or(sql`${requests.status} <> 'draft'`, own);
}

/** Consulta solicitações: todas (requests.read) ou, para clientes que só criam, as próprias. */
export function canReadRequests(actor: Actor): boolean {
  return can(actor, "requests.read") || (actor.kind === "client" && can(actor, "requests.write"));
}

/** Condição SQL sobre `files`. Clientes veem apenas o que foi compartilhado explicitamente. */
export function fileScope(actor: Actor): SQL | undefined {
  const notDeleted = and(isNull(files.deletedAt), fileOwnerAlive)!;
  if (actor.kind === "client") {
    if (!actor.clientIds.length) return FALSE;
    return and(
      notDeleted,
      eq(files.sharedWithClient, true),
      inArray(files.clientId, [...actor.clientIds]),
      // Quem só vê as próprias solicitações não vê anexos das solicitações dos colegas.
      actor.permissions.has("requests.read")
        ? undefined
        : sql`(${files.requestId} is null or exists (select 1 from ${requests} where ${requests.id} = ${files.requestId} and ${requests.createdByUserId} = ${actor.userId}))`,
    );
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

/** Solicitações seguem o escopo do cliente a que pertencem. */
export async function assertRequestAccess(s: Scope, requestId: string) {
  const [row] = await s.db
    .select({ id: requests.id, clientId: requests.clientId, projectId: requests.projectId })
    .from(requests)
    .innerJoin(clients, eq(clients.id, requests.clientId))
    .where(and(eq(requests.id, requestId), clientScope(s.actor), clientRequestFilter(s.actor)))
    .limit(1);
  if (!row) throw new NotFoundError("Solicitação não encontrada.");
  return row;
}
