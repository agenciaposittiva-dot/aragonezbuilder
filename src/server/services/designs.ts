import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { optionalText, optionalUuid, uuid } from "@/lib/validators/common";
import { clients, designs, files, projects, user } from "@/server/db/schema";
import {
  assertCan,
  assertClientAccess,
  assertFileAccess,
  assertInternal,
  assertProjectAccess,
  assertTaskAccess,
  can,
  clientScope,
  type Scope,
} from "@/server/authz";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_THUMB_BYTES = 200 * 1024;

export const designCreateInput = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  width: z.coerce.number().int().min(16).max(10000),
  height: z.coerce.number().int().min(16).max(10000),
  clientId: optionalUuid,
  projectId: optionalUuid,
  taskId: optionalUuid,
  templateId: optionalUuid,
  isTemplate: z.boolean().default(false),
  templateCategory: optionalText(60),
});

export const designSaveInput = z.object({
  id: uuid,
  revision: z.number().int().min(1),
  document: z.record(z.string(), z.unknown()),
  thumbnail: z
    .string()
    .max(MAX_THUMB_BYTES * 1.4)
    .regex(/^data:image\/(jpeg|png|webp);base64,/, "Prévia inválida")
    .nullable()
    .optional(),
});

export const designMetaInput = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(120),
  clientId: optionalUuid,
  projectId: optionalUuid,
  taskId: optionalUuid,
  isTemplate: z.boolean().optional(),
  templateCategory: optionalText(60),
});

/** Artes visíveis: sem cliente (internas) ou de clientes no escopo do ator. */
function designScope(s: Scope) {
  const visibleClients = s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
  return or(isNull(designs.clientId), inArray(designs.clientId, visibleClients));
}

async function assertLinks(
  s: Scope,
  d: { clientId?: string | null; projectId?: string | null; taskId?: string | null },
) {
  let clientId = d.clientId ?? null;
  if (d.taskId) {
    const t = await assertTaskAccess(s, d.taskId);
    if (d.projectId && d.projectId !== t.projectId)
      throw new ValidationError("A tarefa não pertence ao projeto escolhido.");
    d.projectId = t.projectId;
  }
  if (d.projectId) {
    const p = await assertProjectAccess(s, d.projectId);
    if (clientId && clientId !== p.clientId) throw new ValidationError("O projeto não pertence ao cliente escolhido.");
    clientId = p.clientId;
  }
  if (clientId) await assertClientAccess(s, clientId);
  return { clientId, projectId: d.projectId ?? null, taskId: d.taskId ?? null };
}

export async function listDesigns(s: Scope, opts: { q?: string; templates?: boolean; clientId?: string } = {}) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.read");
  return s.db
    .select({
      id: designs.id,
      name: designs.name,
      width: designs.width,
      height: designs.height,
      thumbnail: designs.thumbnail,
      isTemplate: designs.isTemplate,
      templateCategory: designs.templateCategory,
      updatedAt: designs.updatedAt,
      clientId: designs.clientId,
      clientName: clients.name,
      projectName: projects.name,
      updatedByName: user.name,
    })
    .from(designs)
    .leftJoin(clients, eq(clients.id, designs.clientId))
    .leftJoin(projects, eq(projects.id, designs.projectId))
    .leftJoin(user, eq(user.id, designs.updatedByUserId))
    .where(
      and(
        designScope(s),
        isNull(designs.archivedAt),
        eq(designs.isTemplate, !!opts.templates),
        opts.clientId ? eq(designs.clientId, opts.clientId) : undefined,
        opts.q ? ilike(designs.name, `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
      ),
    )
    .orderBy(desc(designs.updatedAt))
    .limit(200);
}

export async function getDesign(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.read");
  const [row] = await s.db
    .select({ design: designs, clientName: clients.name, projectName: projects.name })
    .from(designs)
    .leftJoin(clients, eq(clients.id, designs.clientId))
    .leftJoin(projects, eq(projects.id, designs.projectId))
    .where(and(eq(designs.id, id), designScope(s), isNull(designs.archivedAt)));
  if (!row) throw new NotFoundError("Arte não encontrada.");
  return row;
}

export async function createDesign(s: Scope, raw: z.input<typeof designCreateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = designCreateInput.parse(raw);
  if (data.isTemplate) assertCan(s.actor, "templates.manage");
  const links = await assertLinks(s, data);

  let document: Record<string, unknown> = { version: "7", objects: [], background: "#ffffff" };
  let width = data.width;
  let height = data.height;
  if (data.templateId) {
    const template = await getDesign(s, data.templateId);
    if (!template.design.isTemplate) throw new ValidationError("O modelo escolhido não é um template.");
    document = template.design.document;
    width = template.design.width;
    height = template.design.height;
  }

  const [row] = await s.db
    .insert(designs)
    .values({
      organizationId: s.actor.orgId,
      ...links,
      name: data.name,
      width,
      height,
      document,
      isTemplate: data.isTemplate,
      templateCategory: data.templateCategory,
      createdByUserId: s.actor.userId,
      updatedByUserId: s.actor.userId,
    })
    .returning({ id: designs.id });
  await recordActivity(s, {
    action: "created",
    entityType: "design",
    entityId: row!.id,
    summary: `${data.isTemplate ? "Template" : "Arte"} "${data.name}" criad${data.isTemplate ? "o" : "a"}`,
    event: false,
  });
  return { id: row!.id };
}

/**
 * Salva a cena do editor com controle de concorrência otimista: se outra
 * pessoa salvou depois que você abriu, o salvamento é recusado (sem perder
 * o trabalho de ninguém) e o editor oferece recarregar.
 */
export async function saveDesign(s: Scope, raw: z.input<typeof designSaveInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = designSaveInput.parse(raw);
  const current = await getDesign(s, data.id);
  if (current.design.isTemplate) assertCan(s.actor, "templates.manage");
  const size = Buffer.byteLength(JSON.stringify(data.document));
  if (size > MAX_DOCUMENT_BYTES) {
    throw new ValidationError("A arte ficou grande demais para salvar. Reduza o tamanho das imagens inseridas.");
  }
  const res = await s.db
    .update(designs)
    .set({
      document: data.document,
      ...(data.thumbnail !== undefined ? { thumbnail: data.thumbnail } : {}),
      revision: sql`${designs.revision} + 1`,
      updatedByUserId: s.actor.userId,
    })
    .where(and(eq(designs.id, data.id), eq(designs.revision, data.revision)))
    .returning({ revision: designs.revision, updatedAt: designs.updatedAt });
  if (!res.length) {
    throw new ConflictError(
      "Esta arte foi salva por outra pessoa depois que você a abriu. Recarregue para ver a versão mais recente.",
    );
  }
  return res[0]!;
}

export async function updateDesignMeta(s: Scope, raw: z.input<typeof designMetaInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = designMetaInput.parse(raw);
  const current = await getDesign(s, data.id);
  if (data.isTemplate !== undefined && data.isTemplate !== current.design.isTemplate)
    assertCan(s.actor, "templates.manage");
  const links = await assertLinks(s, data);
  await s.db
    .update(designs)
    .set({
      name: data.name,
      ...links,
      ...(data.isTemplate !== undefined ? { isTemplate: data.isTemplate } : {}),
      templateCategory: data.templateCategory,
      updatedByUserId: s.actor.userId,
    })
    .where(eq(designs.id, data.id));
}

export async function duplicateDesign(s: Scope, id: string, asTemplate = false) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  if (asTemplate) assertCan(s.actor, "templates.manage");
  const src = await getDesign(s, id);
  const [row] = await s.db
    .insert(designs)
    .values({
      organizationId: s.actor.orgId,
      clientId: src.design.clientId,
      projectId: asTemplate ? null : src.design.projectId,
      taskId: asTemplate ? null : src.design.taskId,
      name: asTemplate ? `${src.design.name} (template)` : `${src.design.name} (cópia)`,
      width: src.design.width,
      height: src.design.height,
      document: src.design.document,
      thumbnail: src.design.thumbnail,
      isTemplate: asTemplate,
      templateCategory: src.design.templateCategory,
      createdByUserId: s.actor.userId,
      updatedByUserId: s.actor.userId,
    })
    .returning({ id: designs.id });
  return { id: row!.id };
}

export async function archiveDesign(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const d = await getDesign(s, id);
  if (d.design.isTemplate && !can(s.actor, "templates.manage")) throw new ForbiddenError();
  await s.db.update(designs).set({ archivedAt: new Date() }).where(eq(designs.id, id));
  await recordActivity(s, {
    action: "archived",
    entityType: "design",
    entityId: id,
    summary: `Arte "${d.design.name}" arquivada`,
    event: false,
  });
}

/** Vincula o arquivo gerado pela exportação (nova versão em Arquivos). */
export async function linkDesignOutput(s: Scope, designId: string, fileId: string, versionId: string | null) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const d = await getDesign(s, designId);
  await assertFileAccess(s, fileId);
  const [file] = await s.db.select({ clientId: files.clientId }).from(files).where(eq(files.id, fileId));
  if (d.design.clientId && file?.clientId && file.clientId !== d.design.clientId) {
    throw new ValidationError("O arquivo pertence a outro cliente.");
  }
  await s.db.update(designs).set({ outputFileId: fileId }).where(eq(designs.id, designId));
  await recordActivity(s, {
    action: "exported",
    entityType: "design",
    entityId: designId,
    summary: `Arte "${d.design.name}" exportada para Arquivos`,
    event: {
      type: "design.exported",
      payload: {
        designId,
        fileId,
        versionId,
        clientId: d.design.clientId,
        projectId: d.design.projectId,
        taskId: d.design.taskId,
      },
    },
  });
}
