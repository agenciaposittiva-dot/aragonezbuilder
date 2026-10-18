import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import sharp from "sharp";
import type { z } from "zod";
import {
  fileListParams,
  fileUpdateInput,
  folderInput,
  uploadMetaInput,
  type FileCategory,
} from "@/lib/validators/files";
import {
  approvals,
  auditLogs,
  clients,
  domainEvents,
  fileFavorites,
  files,
  fileVersions,
  folders,
  projects,
  requests,
  tasks,
  user,
} from "@/server/db/schema";
import {
  assertCan,
  assertClientAccess,
  assertFileAccess,
  assertInternal,
  assertProjectAccess,
  assertRequestAccess,
  assertTaskAccess,
  can,
  fileScope,
  type Scope,
} from "@/server/authz";
import { inSequence } from "@/server/db/sequence";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { getStorage, versionKey } from "@/server/storage";
import { diff, recordActivity } from "./activity";
import { isAllowedType, isImage, sniffFileType } from "./file-type";

const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export type UploadInput = {
  buffer: Buffer;
  originalName: string;
};

/** Limite efetivo de tamanho: o menor entre o do servidor e o da organização. */
export function maxUploadBytes(s: Scope) {
  return Math.min(env.UPLOAD_MAX_BYTES, s.actor.settings.uploads.maxBytes);
}

/**
 * Valida conteúdo e tamanho. O tipo é identificado pelos bytes do arquivo;
 * o tipo declarado pelo navegador é ignorado.
 */
export function validateUpload(s: Scope, input: UploadInput) {
  if (!input.buffer.length) throw new ValidationError("O arquivo está vazio.");
  const limit = maxUploadBytes(s);
  if (input.buffer.length > limit) {
    throw new ValidationError(`O arquivo excede o limite de ${Math.round(limit / (1024 * 1024))} MB.`);
  }
  const sniffed = sniffFileType(input.buffer, input.originalName);
  if (!sniffed) throw new ValidationError("Tipo de arquivo não reconhecido ou não permitido.");
  if (!isAllowedType(sniffed.mime, s.actor.settings.uploads.allowedTypes)) {
    throw new ValidationError(`Tipo de arquivo não permitido (${sniffed.mime}).`);
  }
  return sniffed;
}

type Links = {
  clientId: string | null;
  projectId: string | null;
  taskId: string | null;
  requestId: string | null;
  folderId: string | null;
};

/** Resolve e valida os vínculos (cliente/projeto/tarefa/solicitação/pasta) dentro do escopo do ator. */
async function resolveLinks(s: Scope, meta: z.output<typeof uploadMetaInput>): Promise<Links> {
  let { clientId, projectId } = meta;
  const { taskId, requestId, folderId } = meta;
  if (taskId) {
    const t = await assertTaskAccess(s, taskId);
    projectId = projectId ?? t.projectId;
    if (projectId !== t.projectId) throw new ValidationError("A tarefa não pertence ao projeto informado.");
  }
  if (projectId) {
    const p = await assertProjectAccess(s, projectId);
    clientId = clientId ?? p.clientId;
    if (clientId !== p.clientId) throw new ValidationError("O projeto não pertence ao cliente informado.");
  }
  if (requestId) {
    const r = await assertRequestAccess(s, requestId);
    clientId = clientId ?? r.clientId;
    if (clientId !== r.clientId) throw new ValidationError("A solicitação não pertence ao cliente informado.");
  }
  if (clientId) await assertClientAccess(s, clientId);
  if (folderId) {
    const [f] = await s.db.select().from(folders).where(eq(folders.id, folderId));
    if (!f) throw new NotFoundError("Pasta não encontrada.");
    if (f.clientId && clientId && f.clientId !== clientId)
      throw new ValidationError("A pasta pertence a outro cliente.");
    clientId = clientId ?? f.clientId;
    projectId = projectId ?? f.projectId;
  }
  return {
    clientId: clientId ?? null,
    projectId: projectId ?? null,
    taskId: taskId ?? null,
    requestId: requestId ?? null,
    folderId: folderId ?? null,
  };
}

async function imageSize(buffer: Buffer, mime: string) {
  if (!isImage(mime)) return { width: null, height: null };
  try {
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Armazena um upload como novo arquivo ou nova versão de um arquivo existente.
 * Uma nova versão volta o arquivo para rascunho e invalida (superseded) toda
 * aprovação pendente das versões anteriores: aprovações nunca são herdadas.
 */
export async function storeUpload(s: Scope, input: UploadInput, rawMeta: z.input<typeof uploadMetaInput>) {
  const meta = uploadMetaInput.parse(rawMeta);
  const isClient = s.actor.kind === "client";

  if (isClient) {
    // Clientes só anexam arquivos às próprias solicitações.
    if (!meta.requestId || meta.fileId) throw new ForbiddenError("Envie arquivos a partir de uma solicitação.");
    assertCan(s.actor, "requests.write");
  } else {
    assertCan(s.actor, "files.write");
  }

  const sniffed = validateUpload(s, input);
  const originalName = input.originalName.trim().slice(0, 200) || `arquivo.${sniffed.ext}`;
  const checksum = createHash("sha256").update(input.buffer).digest("hex");
  const { width, height } = await imageSize(input.buffer, sniffed.mime);
  const storage = getStorage();
  const versionId = randomUUID();

  let fileId: string;
  let versionNumber = 1;
  let links: Links;
  let fileName = originalName;

  if (meta.fileId) {
    await assertFileAccess(s, meta.fileId);
    const [file] = await s.db.select().from(files).where(eq(files.id, meta.fileId));
    if (!file) throw new NotFoundError("Arquivo não encontrado.");
    fileId = file.id;
    fileName = file.name;
    links = {
      clientId: file.clientId,
      projectId: file.projectId,
      taskId: file.taskId,
      requestId: file.requestId,
      folderId: file.folderId,
    };
    const [{ max } = { max: 0 }] = await s.db
      .select({ max: sql<number>`coalesce(max(${fileVersions.versionNumber}), 0)::int` })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    versionNumber = max + 1;
  } else {
    links = await resolveLinks(s, meta);
    fileId = randomUUID();
  }

  const key = versionKey(s.actor.orgId, fileId, versionId, originalName);
  await storage.put(key, input.buffer, { contentType: sniffed.mime });

  try {
    if (!meta.fileId) {
      await s.db.insert(files).values({
        id: fileId,
        organizationId: s.actor.orgId,
        name: originalName,
        // Envios do cliente são referências fornecidas por ele (separadas das entregas da agência).
        category: isClient ? "reference" : meta.category,
        tags: isClient ? [] : meta.tags,
        status: "draft",
        sharedWithClient: isClient,
        createdByUserId: s.actor.userId,
        ...links,
      });
    }
    await s.db.insert(fileVersions).values({
      id: versionId,
      organizationId: s.actor.orgId,
      fileId,
      versionNumber,
      storageKey: key,
      originalName,
      mimeType: sniffed.mime,
      sizeBytes: input.buffer.length,
      checksumSha256: checksum,
      width,
      height,
      note: meta.note,
      source: meta.source,
      uploadedByUserId: s.actor.userId,
    });
    await s.db
      .update(files)
      .set({ currentVersionId: versionId, ...(meta.fileId ? { status: "draft" as const } : {}) })
      .where(eq(files.id, fileId));

    let superseded = 0;
    if (meta.fileId) {
      const res = await s.db
        .update(approvals)
        .set({ status: "superseded" })
        .where(
          and(eq(approvals.fileId, fileId), eq(approvals.status, "pending"), ne(approvals.fileVersionId, versionId)),
        )
        .returning({ id: approvals.id });
      superseded = res.length;
    }

    const payload = {
      fileId,
      versionId,
      versionNumber,
      clientId: links.clientId,
      projectId: links.projectId,
      taskId: links.taskId,
      name: fileName,
    };
    await recordActivity(s, {
      action: meta.fileId ? "version_uploaded" : "uploaded",
      entityType: "file",
      entityId: fileId,
      summary: meta.fileId ? `Nova versão v${versionNumber} de ${fileName}` : `Arquivo enviado: ${originalName}`,
      metadata: { versionNumber, size: input.buffer.length, mime: sniffed.mime, supersededApprovals: superseded },
      clientVisible: isClient,
      event: { type: meta.fileId ? "file.version_uploaded" : "file.uploaded", payload },
    });
    // O processamento assíncrono (miniaturas) é disparado por file.version_uploaded,
    // inclusive para a primeira versão (evento sem entrada extra na auditoria).
    if (!meta.fileId) {
      await s.db.insert(domainEvents).values({
        organizationId: s.actor.orgId,
        type: "file.version_uploaded",
        entityType: "file",
        entityId: fileId,
        actorUserId: s.actor.userId,
        payload,
      });
    }
    return { fileId, versionId, versionNumber, mimeType: sniffed.mime };
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Consulta                                                            */
/* ------------------------------------------------------------------ */

export async function listFiles(s: Scope, raw: z.input<typeof fileListParams>) {
  assertCan(s.actor, "files.read");
  const p = fileListParams.parse(raw);
  const favoriteExpr = sql<boolean>`exists (select 1 from ${fileFavorites} where ${fileFavorites.fileId} = ${files.id} and ${fileFavorites.userId} = ${s.actor.userId})`;
  const where = and(
    fileScope(s.actor),
    p.clientId ? eq(files.clientId, p.clientId) : undefined,
    p.projectId ? eq(files.projectId, p.projectId) : undefined,
    p.taskId ? eq(files.taskId, p.taskId) : undefined,
    p.requestId ? eq(files.requestId, p.requestId) : undefined,
    p.folderId === "root" ? isNull(files.folderId) : p.folderId ? eq(files.folderId, p.folderId) : undefined,
    p.category ? eq(files.category, p.category) : undefined,
    p.categories?.length ? inArray(files.category, p.categories) : undefined,
    p.status ? eq(files.status, p.status) : undefined,
    p.status ? undefined : ne(files.status, "archived"),
    p.final ? inArray(files.status, ["approved", "final"]) : undefined,
    p.tag ? sql`${p.tag} = any(${files.tags})` : undefined,
    p.favorites ? favoriteExpr : undefined,
    p.q ? or(ilike(files.name, ESC(p.q)), sql`${p.q.toLowerCase()} = any(${files.tags})`) : undefined,
  );

  const [rows, [total]] = await inSequence(
    () =>
      s.db
        .select({
          id: files.id,
          name: files.name,
          category: files.category,
          status: files.status,
          tags: files.tags,
          sharedWithClient: files.sharedWithClient,
          clientId: files.clientId,
          clientName: clients.name,
          projectId: files.projectId,
          projectName: projects.name,
          projectVisible: projects.portalVisible,
          updatedAt: files.updatedAt,
          versionId: fileVersions.id,
          versionNumber: fileVersions.versionNumber,
          mimeType: fileVersions.mimeType,
          sizeBytes: fileVersions.sizeBytes,
          width: fileVersions.width,
          height: fileVersions.height,
          thumbnailKey: fileVersions.thumbnailKey,
          favorite: favoriteExpr,
        })
        .from(files)
        .leftJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
        .leftJoin(clients, eq(clients.id, files.clientId))
        .leftJoin(projects, eq(projects.id, files.projectId))
        .where(where)
        .orderBy(desc(files.updatedAt))
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize),
    () => s.db.select({ n: count() }).from(files).where(where),
  );
  return {
    rows: rows.map(({ thumbnailKey, projectVisible, ...r }) =>
      // Para convidados: sem etiquetas internas e sem nome de projeto oculto no portal.
      s.actor.kind === "client"
        ? {
            ...r,
            tags: [],
            projectId: projectVisible ? r.projectId : null,
            projectName: projectVisible ? r.projectName : null,
            hasThumbnail: !!thumbnailKey,
          }
        : { ...r, hasThumbnail: !!thumbnailKey },
    ),
    total: total?.n ?? 0,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export type FileListRow = Awaited<ReturnType<typeof listFiles>>["rows"][number];

export async function getFile(s: Scope, id: string) {
  assertCan(s.actor, "files.read");
  await assertFileAccess(s, id);
  const isClient = s.actor.kind === "client";
  const [row] = await s.db
    .select({
      file: files,
      clientName: clients.name,
      projectName: projects.name,
      taskTitle: tasks.title,
      requestNumber: requests.number,
      requestTitle: requests.title,
      folderName: folders.name,
      createdByName: user.name,
    })
    .from(files)
    .leftJoin(clients, eq(clients.id, files.clientId))
    .leftJoin(projects, eq(projects.id, files.projectId))
    .leftJoin(tasks, eq(tasks.id, files.taskId))
    .leftJoin(requests, eq(requests.id, files.requestId))
    .leftJoin(folders, eq(folders.id, files.folderId))
    .leftJoin(user, eq(user.id, files.createdByUserId))
    .where(eq(files.id, id));
  if (!row) throw new NotFoundError("Arquivo não encontrado.");

  const [versions, [fav]] = await inSequence(
    () =>
      s.db
        .select({
          id: fileVersions.id,
          versionNumber: fileVersions.versionNumber,
          originalName: fileVersions.originalName,
          mimeType: fileVersions.mimeType,
          sizeBytes: fileVersions.sizeBytes,
          width: fileVersions.width,
          height: fileVersions.height,
          thumbnailKey: fileVersions.thumbnailKey,
          note: fileVersions.note,
          source: fileVersions.source,
          createdAt: fileVersions.createdAt,
          uploadedByName: user.name,
        })
        .from(fileVersions)
        .leftJoin(user, eq(user.id, fileVersions.uploadedByUserId))
        .where(eq(fileVersions.fileId, id))
        .orderBy(desc(fileVersions.versionNumber)),
    () =>
      s.db
        .select({ fileId: fileFavorites.fileId })
        .from(fileFavorites)
        .where(and(eq(fileFavorites.fileId, id), eq(fileFavorites.userId, s.actor.userId))),
  );

  return {
    file: isClient ? { ...row.file, description: row.file.description } : row.file,
    clientName: row.clientName,
    projectName: isClient ? row.projectName : row.projectName,
    taskTitle: isClient ? null : row.taskTitle,
    requestNumber: row.requestNumber,
    requestTitle: row.requestTitle,
    folderName: isClient ? null : row.folderName,
    createdByName: row.createdByName,
    versions: versions.map(({ thumbnailKey, ...v }) => ({ ...v, hasThumbnail: !!thumbnailKey })),
    favorite: !!fav,
  };
}

export type FileDetail = Awaited<ReturnType<typeof getFile>>;

/** Dados da versão para download (já com verificação de acesso). */
export async function getVersionForDownload(s: Scope, versionId: string) {
  const [v] = await s.db
    .select({
      id: fileVersions.id,
      fileId: fileVersions.fileId,
      storageKey: fileVersions.storageKey,
      thumbnailKey: fileVersions.thumbnailKey,
      originalName: fileVersions.originalName,
      mimeType: fileVersions.mimeType,
    })
    .from(fileVersions)
    .where(eq(fileVersions.id, versionId));
  if (!v) throw new NotFoundError("Versão não encontrada.");
  await assertFileAccess(s, v.fileId);
  return v;
}

/* ------------------------------------------------------------------ */
/* Edição                                                              */
/* ------------------------------------------------------------------ */

export async function updateFile(s: Scope, raw: z.input<typeof fileUpdateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.write");
  const data = fileUpdateInput.parse(raw);
  await assertFileAccess(s, data.id);
  const [before] = await s.db.select().from(files).where(eq(files.id, data.id));
  if (!before) throw new NotFoundError();
  if (data.folderId) {
    const [f] = await s.db
      .select({ id: folders.id, clientId: folders.clientId })
      .from(folders)
      .where(eq(folders.id, data.folderId));
    if (!f) throw new NotFoundError("Pasta não encontrada.");
    if (f.clientId && before.clientId && f.clientId !== before.clientId) {
      throw new ValidationError("A pasta pertence a outro cliente.");
    }
  }
  const patch = {
    name: data.name,
    description: data.description,
    category: data.category,
    tags: [...new Set(data.tags)],
    status: data.status,
    folderId: data.folderId,
  };
  const changes = diff(before, patch);
  if (!Object.keys(changes).length) return;
  await s.db.update(files).set(patch).where(eq(files.id, data.id));
  await recordActivity(s, {
    action: changes.status ? "status_changed" : "updated",
    entityType: "file",
    entityId: data.id,
    summary: changes.status ? `Status do arquivo: ${String(changes.status.to)}` : "Arquivo atualizado",
    changes,
    clientVisible: before.sharedWithClient && !!changes.status,
    event: changes.status
      ? {
          type: "file.status_changed",
          payload: {
            fileId: data.id,
            clientId: before.clientId,
            projectId: before.projectId,
            name: data.name,
            fromStatus: before.status,
            toStatus: data.status,
            shared: before.sharedWithClient,
          },
        }
      : false,
  });
}

export async function setFileShared(s: Scope, fileId: string, shared: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.share");
  await assertFileAccess(s, fileId);
  const [file] = await s.db
    .select({ clientId: files.clientId, name: files.name })
    .from(files)
    .where(eq(files.id, fileId));
  if (!file) throw new NotFoundError();
  if (shared && !file.clientId) throw new ValidationError("Associe o arquivo a um cliente antes de compartilhar.");
  await s.db.update(files).set({ sharedWithClient: shared }).where(eq(files.id, fileId));
  await recordActivity(s, {
    action: shared ? "shared" : "unshared",
    entityType: "file",
    entityId: fileId,
    summary: shared ? `Compartilhado com o cliente: ${file.name}` : `Compartilhamento removido: ${file.name}`,
    clientVisible: shared,
    event: { type: "file.shared", payload: { fileId, clientId: file.clientId, shared } },
  });
}

export async function toggleFavorite(s: Scope, fileId: string) {
  await assertFileAccess(s, fileId);
  const deleted = await s.db
    .delete(fileFavorites)
    .where(and(eq(fileFavorites.fileId, fileId), eq(fileFavorites.userId, s.actor.userId)))
    .returning({ fileId: fileFavorites.fileId });
  if (deleted.length) return { favorite: false };
  await s.db.insert(fileFavorites).values({ organizationId: s.actor.orgId, fileId, userId: s.actor.userId });
  return { favorite: true };
}

/** Exclusão lógica: o arquivo some das listas, mas versões e histórico são preservados. */
export async function deleteFile(s: Scope, fileId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.delete");
  await assertFileAccess(s, fileId);
  const [row] = await s.db
    .update(files)
    .set({ deletedAt: new Date() })
    .where(eq(files.id, fileId))
    .returning({ name: files.name });
  await s.db
    .update(approvals)
    .set({ status: "cancelled" })
    .where(and(eq(approvals.fileId, fileId), eq(approvals.status, "pending")));
  await recordActivity(s, {
    action: "deleted",
    entityType: "file",
    entityId: fileId,
    summary: `Arquivo excluído: ${row?.name ?? ""}`,
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Pastas                                                              */
/* ------------------------------------------------------------------ */

export async function listFolders(s: Scope, scope: { clientId?: string | null; projectId?: string | null } = {}) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.read");
  return s.db
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
      clientId: folders.clientId,
      projectId: folders.projectId,
      files: sql<number>`(select count(*)::int from ${files} where ${files.folderId} = ${folders.id} and ${files.deletedAt} is null)`,
    })
    .from(folders)
    .where(
      and(
        scope.clientId !== undefined
          ? scope.clientId
            ? eq(folders.clientId, scope.clientId)
            : isNull(folders.clientId)
          : undefined,
        scope.projectId !== undefined
          ? scope.projectId
            ? eq(folders.projectId, scope.projectId)
            : isNull(folders.projectId)
          : undefined,
      ),
    )
    .orderBy(asc(folders.name));
}

export async function saveFolder(s: Scope, raw: z.input<typeof folderInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.write");
  const data = folderInput.parse(raw);
  if (data.clientId) await assertClientAccess(s, data.clientId);
  if (data.projectId) await assertProjectAccess(s, data.projectId);
  if (data.id) {
    const res = await s.db
      .update(folders)
      .set({ name: data.name })
      .where(eq(folders.id, data.id))
      .returning({ id: folders.id });
    if (!res.length) throw new NotFoundError("Pasta não encontrada.");
    return { id: data.id };
  }
  let clientId = data.clientId;
  let projectId = data.projectId;
  if (data.parentId) {
    const [parent] = await s.db.select().from(folders).where(eq(folders.id, data.parentId));
    if (!parent) throw new NotFoundError("Pasta superior não encontrada.");
    clientId = clientId ?? parent.clientId;
    projectId = projectId ?? parent.projectId;
  }
  const [row] = await s.db
    .insert(folders)
    .values({
      organizationId: s.actor.orgId,
      name: data.name,
      parentId: data.parentId,
      clientId,
      projectId,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: folders.id });
  return { id: row!.id };
}

export async function deleteFolder(s: Scope, folderId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.delete");
  const [[filesIn], [children]] = await inSequence(
    () =>
      s.db
        .select({ n: count() })
        .from(files)
        .where(and(eq(files.folderId, folderId), isNull(files.deletedAt))),
    () => s.db.select({ n: count() }).from(folders).where(eq(folders.parentId, folderId)),
  );
  if ((filesIn?.n ?? 0) > 0 || (children?.n ?? 0) > 0) {
    throw new ValidationError("Esvazie a pasta (arquivos e subpastas) antes de excluí-la.");
  }
  // Arquivos excluídos logicamente voltam para a raiz para não bloquear a exclusão.
  await s.db.update(files).set({ folderId: null }).where(eq(files.folderId, folderId));
  const res = await s.db.delete(folders).where(eq(folders.id, folderId)).returning({ id: folders.id });
  if (!res.length) throw new NotFoundError("Pasta não encontrada.");
}

/* ------------------------------------------------------------------ */
/* Biblioteca de marca                                                 */
/* ------------------------------------------------------------------ */

export const BRAND_CATEGORIES: FileCategory[] = ["brand_logo", "brand_asset", "brand_guideline", "template"];

export async function setClientLogo(s: Scope, clientId: string, fileId: string | null) {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  await assertClientAccess(s, clientId);
  if (fileId) {
    await assertFileAccess(s, fileId);
    const [f] = await s.db
      .select({ clientId: files.clientId, mime: fileVersions.mimeType })
      .from(files)
      .leftJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
      .where(eq(files.id, fileId));
    if (!f || f.clientId !== clientId) throw new ValidationError("O logotipo precisa ser um arquivo deste cliente.");
    if (!f.mime || !isImage(f.mime)) throw new ValidationError("Escolha uma imagem (PNG, JPG, WEBP).");
  }
  await s.db.update(clients).set({ logoFileId: fileId }).where(eq(clients.id, clientId));
  await recordActivity(s, {
    action: "logo_updated",
    entityType: "client",
    entityId: clientId,
    summary: fileId ? "Logotipo do cliente definido" : "Logotipo do cliente removido",
    event: false,
  });
}

/** Versões atuais dos logotipos dos clientes (para avatares). */
export async function clientLogoVersions(s: Scope, clientIds: string[]) {
  if (!clientIds.length) return new Map<string, string>();
  const rows = await s.db
    .select({ clientId: clients.id, versionId: files.currentVersionId })
    .from(clients)
    .innerJoin(files, eq(files.id, clients.logoFileId))
    .where(and(inArray(clients.id, clientIds), isNull(files.deletedAt)));
  return new Map(rows.filter((r) => r.versionId).map((r) => [r.clientId, r.versionId!]));
}

export function canUpload(s: Scope) {
  return s.actor.kind === "internal" ? can(s.actor, "files.write") : can(s.actor, "requests.write");
}

/* ------------------------------------------------------------------ */
/* Histórico                                                           */
/* ------------------------------------------------------------------ */

export async function fileHistory(s: Scope, fileId: string, limit = 80) {
  await assertFileAccess(s, fileId);
  return s.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      summary: auditLogs.summary,
      changes: auditLogs.changes,
      createdAt: auditLogs.createdAt,
      actorName: user.name,
      actorImage: user.image,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorUserId))
    .where(
      and(
        eq(auditLogs.entityType, "file"),
        eq(auditLogs.entityId, fileId),
        s.actor.kind === "client" ? eq(auditLogs.clientVisible, true) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
