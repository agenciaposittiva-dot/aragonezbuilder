import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { withOrg, withSystem, type Tx } from "@/server/db";
import {
  aiUsage,
  approvals,
  auditLogs,
  clientAccess,
  clients,
  clientServices,
  designs,
  domainEvents,
  expenses,
  files,
  fileVersions,
  folders,
  invoices,
  memberships,
  organizations,
  projects,
  requests,
  roles,
  tasks,
  user,
} from "@/server/db/schema";
import {
  assertCan,
  assertClientAccess,
  assertInternal,
  assertProjectAccess,
  can,
  clientScope,
  type Actor,
  type Scope,
} from "@/server/authz";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import { recordActivity } from "./activity";

/*
 * Lixeira. Excluir um cliente, projeto, arte ou a própria agência não apaga
 * nada na hora: o registro recebe `deleted_at`, some de todas as telas
 * (os escopos em src/server/authz escondem itens na lixeira) e pode ser
 * restaurado por TRASH_DAYS dias. Depois disso — ou quando alguém escolhe
 * "Excluir definitivamente" — os dados são apagados de verdade, na ordem que
 * os relacionamentos exigem, e os arquivos saem do armazenamento só depois
 * que o banco confirmou a exclusão.
 */

export const TRASH_DAYS = 30;

const DAY = 86_400_000;

export function purgeDate(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_DAYS * DAY);
}

function daysUntil(date: Date) {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY));
}

export type ImpactItem = { key: string; label: string; count: number; effect: "trash" | "kept" | "unlinked" };

/* ------------------------------------------------------------------ */
/* Impacto (mostrado na confirmação)                                   */
/* ------------------------------------------------------------------ */

async function counts(tx: Tx, query: ReturnType<typeof sql>) {
  const res = await tx.execute<Record<string, number>>(query);
  return res.rows[0] ?? {};
}

export async function clientDeletionImpact(s: Scope, clientId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.delete");
  await assertClientAccess(s, clientId);
  const [client] = await s.db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId));
  if (!client) throw new NotFoundError("Cliente não encontrado.");
  const c = await counts(
    s.db,
    sql`
    select
      (select count(*)::int from ${projects} p where p.client_id = ${clientId} and p.deleted_at is null) as projects,
      (select count(*)::int from ${tasks} t join ${projects} p on p.id = t.project_id
        where p.client_id = ${clientId} and p.deleted_at is null and t.archived_at is null) as tasks,
      (select count(*)::int from ${files} f where f.client_id = ${clientId} and f.deleted_at is null) as files,
      (select count(*)::int from ${approvals} a join ${files} f on f.id = a.file_id
        where f.client_id = ${clientId} and f.deleted_at is null and a.status = 'pending') as approvals,
      (select count(*)::int from ${requests} r where r.client_id = ${clientId}) as requests,
      (select count(*)::int from ${designs} d where d.client_id = ${clientId} and d.deleted_at is null) as designs,
      (select count(*)::int from ${invoices} i where i.client_id = ${clientId}) as invoices,
      (select count(*)::int from ${clientServices} cs where cs.client_id = ${clientId} and cs.status = 'active') as contracts,
      (select count(*)::int from ${clientAccess} ca join ${memberships} m on m.id = ca.membership_id
        where ca.client_id = ${clientId} and m.status = 'active') as guests
  `,
  );
  const items: ImpactItem[] = [
    { key: "projects", label: "Projetos", count: c.projects ?? 0, effect: "trash" },
    { key: "tasks", label: "Tarefas", count: c.tasks ?? 0, effect: "trash" },
    { key: "files", label: "Arquivos", count: c.files ?? 0, effect: "trash" },
    { key: "approvals", label: "Aprovações pendentes", count: c.approvals ?? 0, effect: "trash" },
    { key: "requests", label: "Solicitações", count: c.requests ?? 0, effect: "trash" },
    { key: "designs", label: "Artes do Estúdio", count: c.designs ?? 0, effect: "trash" },
    { key: "invoices", label: "Faturas", count: c.invoices ?? 0, effect: "trash" },
    { key: "contracts", label: "Contratos ativos", count: c.contracts ?? 0, effect: "trash" },
    { key: "guests", label: "Convidados com acesso ao portal", count: c.guests ?? 0, effect: "trash" },
  ];
  return { name: client.name, items, finance: (c.invoices ?? 0) + (c.contracts ?? 0) > 0 };
}

export async function projectDeletionImpact(s: Scope, projectId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "projects.delete");
  await assertProjectAccess(s, projectId);
  const [project] = await s.db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw new NotFoundError("Projeto não encontrado.");
  const c = await counts(
    s.db,
    sql`
    select
      (select count(*)::int from ${tasks} t where t.project_id = ${projectId} and t.archived_at is null) as tasks,
      (select count(*)::int from ${files} f where f.project_id = ${projectId} and f.deleted_at is null) as files,
      (select count(*)::int from ${approvals} a join ${files} f on f.id = a.file_id
        where f.project_id = ${projectId} and f.deleted_at is null and a.status = 'pending') as approvals,
      (select count(*)::int from ${designs} d where d.project_id = ${projectId} and d.deleted_at is null) as designs,
      (select count(*)::int from ${requests} r where r.project_id = ${projectId}) as requests,
      (select count(*)::int from ${invoices} i where i.project_id = ${projectId}) as invoices
  `,
  );
  const items: ImpactItem[] = [
    { key: "tasks", label: "Tarefas (com comentários, checklist e horas)", count: c.tasks ?? 0, effect: "trash" },
    { key: "files", label: "Arquivos do projeto", count: c.files ?? 0, effect: "kept" },
    { key: "approvals", label: "Aprovações pendentes", count: c.approvals ?? 0, effect: "trash" },
    { key: "designs", label: "Artes ligadas ao projeto", count: c.designs ?? 0, effect: "kept" },
    { key: "requests", label: "Solicitações de origem", count: c.requests ?? 0, effect: "unlinked" },
    { key: "invoices", label: "Faturas do projeto", count: c.invoices ?? 0, effect: "unlinked" },
  ];
  return { name: project.name, items };
}

/* ------------------------------------------------------------------ */
/* Mover para a lixeira                                                */
/* ------------------------------------------------------------------ */

export async function trashClient(s: Scope, clientId: string, opts: { confirmFinance?: boolean } = {}) {
  const impact = await clientDeletionImpact(s, clientId);
  if (impact.finance && !opts.confirmFinance) {
    throw new ValidationError("Este cliente tem faturas ou contratos. Confirme que eles também vão para a lixeira.", {
      confirmFinance: ["Confirme a exclusão dos registros financeiros"],
    });
  }
  const now = new Date();
  await s.db
    .update(clients)
    .set({ deletedAt: now, deletedByUserId: s.actor.userId })
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)));
  // Os projetos vão junto, com a mesma data: é assim que a restauração sabe quais trazer de volta.
  await s.db
    .update(projects)
    .set({ deletedAt: now, deletedByUserId: s.actor.userId })
    .where(and(eq(projects.clientId, clientId), isNull(projects.deletedAt)));
  await recordActivity(s, {
    action: "trashed",
    entityType: "client",
    entityId: clientId,
    summary: `Cliente "${impact.name}" movido para a lixeira`,
    event: false,
  });
  return { name: impact.name, purgeAt: purgeDate(now) };
}

export async function trashProject(s: Scope, projectId: string) {
  const impact = await projectDeletionImpact(s, projectId);
  const now = new Date();
  await s.db
    .update(projects)
    .set({ deletedAt: now, deletedByUserId: s.actor.userId })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  await recordActivity(s, {
    action: "trashed",
    entityType: "project",
    entityId: projectId,
    summary: `Projeto "${impact.name}" movido para a lixeira`,
    event: false,
  });
  return { name: impact.name, purgeAt: purgeDate(now) };
}

export async function trashDesign(s: Scope, designId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.delete");
  const visibleClients = s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
  const [d] = await s.db
    .select({ id: designs.id, name: designs.name, isTemplate: designs.isTemplate, clientId: designs.clientId })
    .from(designs)
    .where(
      and(
        eq(designs.id, designId),
        isNull(designs.deletedAt),
        or(isNull(designs.clientId), inArray(designs.clientId, visibleClients)),
      ),
    );
  if (!d) throw new NotFoundError("Arte não encontrada.");
  if (d.isTemplate) assertCan(s.actor, "templates.manage");
  const now = new Date();
  await s.db.update(designs).set({ deletedAt: now, deletedByUserId: s.actor.userId }).where(eq(designs.id, designId));
  await recordActivity(s, {
    action: "trashed",
    entityType: "design",
    entityId: designId,
    summary: `${d.isTemplate ? "Template" : "Arte"} "${d.name}" movid${d.isTemplate ? "o" : "a"} para a lixeira`,
    event: false,
  });
  return { name: d.name, purgeAt: purgeDate(now) };
}

/* ------------------------------------------------------------------ */
/* Lixeira: listar, restaurar, excluir definitivamente                 */
/* ------------------------------------------------------------------ */

export type TrashKind = "client" | "project" | "design";

export type TrashItem = {
  kind: TrashKind;
  id: string;
  name: string;
  detail: string | null;
  deletedAt: Date;
  purgeAt: Date;
  /** Dias até a exclusão definitiva. */
  daysLeft: number;
  deletedByName: string | null;
  /** Restaurar exige restaurar antes o cliente (projeto excluído junto com ele). */
  blockedBy: string | null;
};

/** Quem pode ver/agir sobre um item da lixeira: acesso total aos dados ou quem excluiu. */
function trashOwnerFilter(
  actor: Actor,
  column: typeof clients.deletedByUserId | typeof projects.deletedByUserId | typeof designs.deletedByUserId,
) {
  return actor.dataAll ? undefined : eq(column, actor.userId);
}

export async function listTrash(s: Scope): Promise<TrashItem[]> {
  assertInternal(s.actor);
  const out: TrashItem[] = [];
  if (can(s.actor, "clients.delete")) {
    const rows = await s.db
      .select({ id: clients.id, name: clients.name, deletedAt: clients.deletedAt, by: user.name })
      .from(clients)
      .leftJoin(user, eq(user.id, clients.deletedByUserId))
      .where(and(isNotNull(clients.deletedAt), trashOwnerFilter(s.actor, clients.deletedByUserId)))
      .orderBy(desc(clients.deletedAt));
    out.push(
      ...rows.map((r) => ({
        kind: "client" as const,
        id: r.id,
        name: r.name,
        detail: "Cliente, com projetos, tarefas e arquivos",
        deletedAt: r.deletedAt!,
        purgeAt: purgeDate(r.deletedAt!),
        daysLeft: daysUntil(purgeDate(r.deletedAt!)),
        deletedByName: r.by,
        blockedBy: null,
      })),
    );
  }
  if (can(s.actor, "projects.delete")) {
    // Projetos que foram para a lixeira junto com o cliente aparecem dentro do cliente, não aqui.
    const rows = await s.db
      .select({
        id: projects.id,
        name: projects.name,
        clientName: clients.name,
        deletedAt: projects.deletedAt,
        clientDeletedAt: clients.deletedAt,
        by: user.name,
      })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(user, eq(user.id, projects.deletedByUserId))
      .where(
        and(
          isNotNull(projects.deletedAt),
          sql`(${clients.deletedAt} is null or ${clients.deletedAt} <> ${projects.deletedAt})`,
          trashOwnerFilter(s.actor, projects.deletedByUserId),
        ),
      )
      .orderBy(desc(projects.deletedAt));
    out.push(
      ...rows.map((r) => ({
        kind: "project" as const,
        id: r.id,
        name: r.name,
        detail: `Projeto de ${r.clientName}`,
        deletedAt: r.deletedAt!,
        purgeAt: purgeDate(r.deletedAt!),
        daysLeft: daysUntil(purgeDate(r.deletedAt!)),
        deletedByName: r.by,
        blockedBy: r.clientDeletedAt ? `O cliente ${r.clientName} também está na lixeira. Restaure-o primeiro.` : null,
      })),
    );
  }
  if (can(s.actor, "designs.delete")) {
    const rows = await s.db
      .select({
        id: designs.id,
        name: designs.name,
        isTemplate: designs.isTemplate,
        clientName: clients.name,
        clientDeletedAt: clients.deletedAt,
        deletedAt: designs.deletedAt,
        by: user.name,
      })
      .from(designs)
      .leftJoin(clients, eq(clients.id, designs.clientId))
      .leftJoin(user, eq(user.id, designs.deletedByUserId))
      .where(and(isNotNull(designs.deletedAt), trashOwnerFilter(s.actor, designs.deletedByUserId)))
      .orderBy(desc(designs.deletedAt));
    out.push(
      ...rows.map((r) => ({
        kind: "design" as const,
        id: r.id,
        name: r.name,
        detail: `${r.isTemplate ? "Template" : "Arte"} do Estúdio${r.clientName ? ` · ${r.clientName}` : ""}`,
        deletedAt: r.deletedAt!,
        purgeAt: purgeDate(r.deletedAt!),
        daysLeft: daysUntil(purgeDate(r.deletedAt!)),
        deletedByName: r.by,
        blockedBy: r.clientDeletedAt ? `O cliente ${r.clientName} está na lixeira. Restaure-o primeiro.` : null,
      })),
    );
  }
  return out.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

const KIND_PERMISSION = {
  client: "clients.delete",
  project: "projects.delete",
  design: "designs.delete",
} as const;

/** Localiza um item na lixeira respeitando permissão e dono da exclusão. */
async function trashedItem(s: Scope, kind: TrashKind, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, KIND_PERMISSION[kind]);
  const items = await listTrash(s);
  const item = items.find((i) => i.kind === kind && i.id === id);
  if (item) return item;
  // Projeto excluído junto com o cliente: não aparece na lista, mas existe.
  if (kind === "project") {
    const [row] = await s.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), isNotNull(projects.deletedAt)));
    if (row) throw new ValidationError("Este projeto foi excluído junto com o cliente. Restaure o cliente.");
  }
  throw new NotFoundError("Item não encontrado na lixeira.");
}

export async function restoreFromTrash(s: Scope, kind: TrashKind, id: string) {
  const item = await trashedItem(s, kind, id);
  if (item.blockedBy) throw new ValidationError(item.blockedBy);
  if (kind === "client") {
    await s.db
      .update(projects)
      .set({ deletedAt: null, deletedByUserId: null })
      .where(and(eq(projects.clientId, id), eq(projects.deletedAt, item.deletedAt)));
    await s.db.update(clients).set({ deletedAt: null, deletedByUserId: null }).where(eq(clients.id, id));
  } else if (kind === "project") {
    await s.db.update(projects).set({ deletedAt: null, deletedByUserId: null }).where(eq(projects.id, id));
  } else {
    await s.db.update(designs).set({ deletedAt: null, deletedByUserId: null }).where(eq(designs.id, id));
  }
  await recordActivity(s, {
    action: "restored",
    entityType: kind,
    entityId: id,
    summary: `"${item.name}" restaurado da lixeira`,
    event: false,
  });
  return { name: item.name };
}

export async function purgeFromTrash(s: Scope, kind: TrashKind, id: string) {
  const item = await trashedItem(s, kind, id);
  const keys =
    kind === "client"
      ? await hardDeleteClient(s.db, id)
      : kind === "project"
        ? await hardDeleteProject(s.db, id)
        : await hardDeleteDesign(s.db, id);
  await queueStoragePurge(s.db, s.actor.orgId, keys);
  await recordActivity(s, {
    action: "purged",
    entityType: kind,
    entityId: id,
    summary: `"${item.name}" excluído definitivamente`,
    event: false,
  });
  return { name: item.name };
}

/* ------------------------------------------------------------------ */
/* Exclusão definitiva (ordem dos relacionamentos)                     */
/* ------------------------------------------------------------------ */

/** Os objetos do armazenamento só são apagados depois que o banco confirmou (evento processado após o commit). */
async function queueStoragePurge(tx: Tx, orgId: string, keys: string[]) {
  if (!keys.length) return;
  await tx.insert(domainEvents).values({
    organizationId: orgId,
    type: "storage.purge",
    entityType: "storage",
    payload: { keys },
  });
}

async function storageKeysWhere(tx: Tx, where: SQL | undefined) {
  const rows = await tx
    .select({ key: fileVersions.storageKey, thumb: fileVersions.thumbnailKey })
    .from(fileVersions)
    .where(where);
  return rows.flatMap((r) => [r.key, r.thumb]).filter((k): k is string => !!k);
}

/** Apaga o cliente e tudo que é dele. Devolve as chaves de armazenamento a remover. */
export async function hardDeleteClient(tx: Tx, clientId: string): Promise<string[]> {
  const projectIds = tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId));
  const taskIds = tx.select({ id: tasks.id }).from(tasks).where(inArray(tasks.projectId, projectIds));
  const requestIds = tx.select({ id: requests.id }).from(requests).where(eq(requests.clientId, clientId));
  const fileIds = (
    await tx
      .select({ id: files.id })
      .from(files)
      .where(or(eq(files.clientId, clientId), inArray(files.projectId, projectIds)))
  ).map((r) => r.id);
  const folderIds = tx
    .select({ id: folders.id })
    .from(folders)
    .where(or(eq(folders.clientId, clientId), inArray(folders.projectId, projectIds)));
  const keys = fileIds.length ? await storageKeysWhere(tx, inArray(fileVersions.fileId, fileIds)) : [];
  const notOurFile = fileIds.length ? sql`${files.id} not in ${fileIds}` : sql`true`;

  await tx.delete(designs).where(or(eq(designs.clientId, clientId), inArray(designs.projectId, projectIds)));
  // Vínculos de outros registros com o que vai sumir (raros, mas não podem travar a exclusão).
  await tx.update(designs).set({ taskId: null }).where(inArray(designs.taskId, taskIds));
  if (fileIds.length)
    await tx.update(designs).set({ outputFileId: null }).where(inArray(designs.outputFileId, fileIds));
  await tx
    .update(files)
    .set({ taskId: null })
    .where(and(inArray(files.taskId, taskIds), notOurFile));
  await tx
    .update(files)
    .set({ requestId: null })
    .where(and(inArray(files.requestId, requestIds), notOurFile));
  await tx
    .update(files)
    .set({ folderId: null })
    .where(and(inArray(files.folderId, folderIds), notOurFile));
  await tx.update(approvals).set({ taskId: null }).where(inArray(approvals.taskId, taskIds));
  if (fileIds.length) await tx.delete(files).where(inArray(files.id, fileIds));
  await tx.delete(invoices).where(eq(invoices.clientId, clientId));
  await tx
    .update(expenses)
    .set({ clientId: null, projectId: null })
    .where(or(eq(expenses.clientId, clientId), inArray(expenses.projectId, projectIds)));
  await tx.update(invoices).set({ projectId: null }).where(inArray(invoices.projectId, projectIds));
  await tx.update(requests).set({ projectId: null }).where(inArray(requests.projectId, projectIds));
  await tx.update(tasks).set({ requestId: null }).where(inArray(tasks.requestId, requestIds));
  await tx.update(aiUsage).set({ clientId: null }).where(eq(aiUsage.clientId, clientId));
  await tx.delete(projects).where(eq(projects.clientId, clientId));
  await tx.delete(requests).where(eq(requests.clientId, clientId));
  await tx.delete(clients).where(eq(clients.id, clientId));
  return keys;
}

/**
 * Apaga o projeto e suas tarefas. Arquivos, artes, solicitações e faturas
 * continuam existindo (no cliente), apenas sem o vínculo com o projeto.
 */
export async function hardDeleteProject(tx: Tx, projectId: string): Promise<string[]> {
  const taskIds = tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId));
  const folderIds = tx.select({ id: folders.id }).from(folders).where(eq(folders.projectId, projectId));
  await tx.update(files).set({ folderId: null }).where(inArray(files.folderId, folderIds));
  await tx.update(files).set({ taskId: null }).where(inArray(files.taskId, taskIds));
  await tx.update(files).set({ projectId: null }).where(eq(files.projectId, projectId));
  await tx.update(approvals).set({ taskId: null }).where(inArray(approvals.taskId, taskIds));
  await tx
    .update(designs)
    .set({ projectId: null, taskId: null })
    .where(or(eq(designs.projectId, projectId), inArray(designs.taskId, taskIds)));
  await tx.update(requests).set({ projectId: null }).where(eq(requests.projectId, projectId));
  await tx.update(invoices).set({ projectId: null }).where(eq(invoices.projectId, projectId));
  await tx.update(expenses).set({ projectId: null }).where(eq(expenses.projectId, projectId));
  await tx.delete(projects).where(eq(projects.id, projectId));
  return [];
}

/** Apaga a arte. O arquivo exportado (em Arquivos) continua existindo. */
export async function hardDeleteDesign(tx: Tx, designId: string): Promise<string[]> {
  await tx.delete(designs).where(eq(designs.id, designId));
  return [];
}

/* ------------------------------------------------------------------ */
/* Agência                                                             */
/* ------------------------------------------------------------------ */

function assertOwner(actor: Actor) {
  if (actor.kind !== "internal" || actor.roleKey !== "owner") {
    throw new ForbiddenError("Só o proprietário da agência pode excluí-la.");
  }
}

export async function organizationDeletionImpact(s: Scope) {
  assertOwner(s.actor);
  const c = await counts(
    s.db,
    sql`
    select
      (select count(*)::int from ${clients} where deleted_at is null) as clients,
      (select count(*)::int from ${projects} where deleted_at is null) as projects,
      (select count(*)::int from ${files} where deleted_at is null) as files,
      (select count(*)::int from ${memberships} where status = 'active') as members
  `,
  );
  const items: ImpactItem[] = [
    { key: "clients", label: "Clientes (com portais)", count: c.clients ?? 0, effect: "trash" },
    { key: "projects", label: "Projetos", count: c.projects ?? 0, effect: "trash" },
    { key: "files", label: "Arquivos", count: c.files ?? 0, effect: "trash" },
    { key: "members", label: "Pessoas com acesso (equipe e convidados)", count: c.members ?? 0, effect: "trash" },
  ];
  return { name: s.actor.orgName, items };
}

export async function trashOrganization(s: Scope, confirmName: string) {
  assertOwner(s.actor);
  if (confirmName.trim() !== s.actor.orgName.trim()) {
    throw new ValidationError("Digite o nome da agência exatamente como aparece para confirmar.", {
      confirmName: ["O nome não confere"],
    });
  }
  const now = new Date();
  await s.db
    .update(organizations)
    .set({ deletedAt: now, deletedByUserId: s.actor.userId })
    .where(eq(organizations.id, s.actor.orgId));
  await recordActivity(s, {
    action: "trashed",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: `Agência "${s.actor.orgName}" movida para a lixeira`,
    event: false,
  });
  return { name: s.actor.orgName, purgeAt: purgeDate(now) };
}

/** Agências na lixeira das quais o usuário é proprietário (para restaurar). */
export async function listTrashedOrganizations(userId: string) {
  const rows = await withSystem((tx) =>
    tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        deletedAt: organizations.deletedAt,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          eq(roles.key, "owner"),
          isNotNull(organizations.deletedAt),
        ),
      )
      .orderBy(desc(organizations.deletedAt)),
  );
  return rows.map((r) => ({
    ...r,
    deletedAt: r.deletedAt!,
    purgeAt: purgeDate(r.deletedAt!),
    daysLeft: daysUntil(purgeDate(r.deletedAt!)),
  }));
}

export async function restoreOrganization(userId: string, orgId: string) {
  const owned = await listTrashedOrganizations(userId);
  const org = owned.find((o) => o.id === orgId);
  if (!org) throw new NotFoundError("Agência não encontrada na lixeira.");
  await withOrg(orgId, async (tx) => {
    await tx.update(organizations).set({ deletedAt: null, deletedByUserId: null }).where(eq(organizations.id, orgId));
    await tx.insert(auditLogs).values({
      organizationId: orgId,
      actorUserId: userId,
      action: "restored",
      entityType: "organization",
      entityId: orgId,
      summary: `Agência "${org.name}" restaurada da lixeira`,
    });
  });
  return { slug: org.slug, name: org.name };
}

/* ------------------------------------------------------------------ */
/* Rotina diária: apaga de vez o que passou do prazo                   */
/* ------------------------------------------------------------------ */

export async function purgeExpiredTrash(now = new Date()) {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * DAY);
  const result = { organizations: 0, clients: 0, projects: 0, designs: 0, storageErrors: 0 };

  const expiredOrgs = await withSystem((tx) =>
    tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(isNotNull(organizations.deletedAt), lt(organizations.deletedAt, cutoff))),
  );
  for (const org of expiredOrgs) {
    const keys = await withSystem(async (tx) => {
      const k = await storageKeysWhere(tx, eq(fileVersions.organizationId, org.id));
      const [logo] = await tx
        .select({ key: organizations.logoKey })
        .from(organizations)
        .where(eq(organizations.id, org.id));
      if (logo?.key) k.push(logo.key);
      await tx.delete(organizations).where(eq(organizations.id, org.id));
      return k;
    });
    result.organizations++;
    // Depois do commit: se o armazenamento falhar, o banco já está consistente; fica registrado.
    for (const key of keys) {
      await getStorage()
        .delete(key)
        .catch((err) => {
          result.storageErrors++;
          console.error(`[lixeira] falha ao apagar ${key}`, err);
        });
    }
  }

  const expiredClients = await withSystem((tx) =>
    tx
      .select({ id: clients.id, orgId: clients.organizationId })
      .from(clients)
      .where(and(isNotNull(clients.deletedAt), lt(clients.deletedAt, cutoff))),
  );
  for (const c of expiredClients) {
    await withOrg(c.orgId, async (tx) => queueStoragePurge(tx, c.orgId, await hardDeleteClient(tx, c.id)));
    result.clients++;
  }

  const expiredProjects = await withSystem((tx) =>
    tx
      .select({ id: projects.id, orgId: projects.organizationId })
      .from(projects)
      .where(and(isNotNull(projects.deletedAt), lt(projects.deletedAt, cutoff))),
  );
  for (const p of expiredProjects) {
    await withOrg(p.orgId, (tx) => hardDeleteProject(tx, p.id));
    result.projects++;
  }

  result.designs = await withSystem(async (tx) => {
    const rows = await tx
      .delete(designs)
      .where(and(isNotNull(designs.deletedAt), lt(designs.deletedAt, cutoff)))
      .returning({ id: designs.id });
    return rows.length;
  });
  return result;
}

/** Efeito do evento `storage.purge`: remove objetos (idempotente nos drivers). */
export async function purgeStorageKeys(keys: unknown) {
  if (!Array.isArray(keys)) return;
  const storage = getStorage();
  for (const key of keys) {
    if (typeof key === "string" && key) await storage.delete(key);
  }
}
