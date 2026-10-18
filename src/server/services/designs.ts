import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  applyOperations,
  DesignDocumentError,
  DesignOpError,
  designOpSchema,
  emptyDocument,
  findPreset,
  isDesignDocument,
  parseDesignDocument,
  readDesignDocument,
  versionIdOfSrc,
  type DesignDocument,
  type DesignOp,
} from "@/lib/design-doc";
import { optionalText, optionalUuid, uuid } from "@/lib/validators/common";
import { clients, designs, designVersions, files, fileVersions, projects, user } from "@/server/db/schema";
import {
  assertCan,
  assertClientAccess,
  assertFileAccess,
  assertInternal,
  assertProjectAccess,
  assertTaskAccess,
  can,
  clientScope,
  fileScope,
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
  /** Formato escolhido (ver design-doc/presets). */
  preset: z.string().max(60).optional().nullable(),
  /** Quantidade de páginas da arte nova (carrossel: páginas conectadas). */
  pages: z.coerce.number().int().min(1).max(20).optional(),
  carousel: z.boolean().optional(),
  /** Documento inicial pronto (formato 2 ou antigo), para módulos que geram artes. */
  document: z.record(z.string(), z.unknown()).optional(),
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

/**
 * Artes visíveis: fora da lixeira, sem cliente (internas) ou de clientes no
 * escopo do ator, e cujo projeto (se houver) também não está na lixeira.
 */
function designScope(s: Scope) {
  const visibleClients = s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
  return and(
    isNull(designs.deletedAt),
    or(
      isNull(designs.projectId),
      sql`exists (select 1 from ${projects} where ${projects.id} = ${designs.projectId} and ${projects.deletedAt} is null)`,
    ),
    or(isNull(designs.clientId), inArray(designs.clientId, visibleClients)),
  );
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

export async function listDesigns(
  s: Scope,
  opts: { q?: string; templates?: boolean; clientId?: string; archived?: boolean } = {},
) {
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
        opts.archived ? isNotNull(designs.archivedAt) : isNull(designs.archivedAt),
        opts.archived ? undefined : eq(designs.isTemplate, !!opts.templates),
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

  let width = data.width;
  let height = data.height;
  let document: Record<string, unknown>;
  if (data.templateId) {
    const template = await getDesign(s, data.templateId);
    if (!template.design.isTemplate) throw new ValidationError("O modelo escolhido não é um template.");
    assertTemplateForClient(template.design, links.clientId);
    document = withoutOutputs(template.design.document);
    width = template.design.width;
    height = template.design.height;
  } else if (data.document) {
    const checked = checkDesignDocument(data.document);
    document = checked.document;
    if (checked.size) ({ width, height } = checked.size);
  } else {
    // Arte nova já no formato 2 (uma ou várias páginas; carrossel com páginas conectadas).
    const preset = findPreset(data.preset);
    const carousel = data.carousel ?? preset?.carousel ?? false;
    document = emptyDocument(width, height, {
      pages: data.pages ?? (carousel ? (preset?.pages ?? 3) : 1),
      carousel,
      preset: data.preset ?? null,
    });
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

/** Template de um cliente só é usado em artes do mesmo cliente (templates sem cliente valem para todos). */
function assertTemplateForClient(t: { clientId: string | null }, clientId: string | null) {
  if (t.clientId && t.clientId !== clientId) {
    throw new ValidationError(
      "Este template é exclusivo de outro cliente. Escolha um template da agência ou do mesmo cliente.",
    );
  }
}

/**
 * Cópias (template, duplicação) não herdam os arquivos exportados da original:
 * a próxima exportação cria arquivos novos em vez de versões dos arquivos de outra arte.
 */
function withoutOutputs(doc: Record<string, unknown>): Record<string, unknown> {
  if (!isDesignDocument(doc) || !doc.meta) return doc;
  const { outputs: _o, pdfOutputFileId: _pdf, ...meta } = doc.meta;
  void _o;
  void _pdf;
  return { ...doc, meta };
}

/**
 * Validação do documento recebido: tamanho máximo para qualquer formato e, no
 * formato 2, o esquema completo (o servidor nunca grava um documento 2 inválido).
 * Devolve o tamanho da primeira página, que fica nas colunas width/height.
 */
export function checkDesignDocument(doc: Record<string, unknown>): {
  document: Record<string, unknown>;
  size: { width: number; height: number } | null;
} {
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOCUMENT_BYTES) {
    throw new ValidationError("A arte ficou grande demais para salvar. Reduza o tamanho das imagens inseridas.");
  }
  if (!isDesignDocument(doc)) return { document: doc, size: null };
  try {
    const parsed = parseDesignDocument(doc);
    return {
      document: parsed as unknown as Record<string, unknown>,
      size: { width: parsed.pages[0]!.width, height: parsed.pages[0]!.height },
    };
  } catch (err) {
    if (err instanceof DesignDocumentError) {
      throw new ValidationError(`A arte tem dados inválidos: ${err.issues[0] ?? err.message}`);
    }
    throw err;
  }
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
  const { document, size } = checkDesignDocument(data.document);
  const width = size?.width ?? current.design.width;
  const height = size?.height ?? current.design.height;
  await keepLegacyBeforeConversion(s, current.design, document);
  const res = await s.db
    .update(designs)
    .set({
      document,
      width,
      height,
      ...(data.thumbnail !== undefined ? { thumbnail: data.thumbnail } : {}),
      revision: sql`${designs.revision} + 1`,
      updatedByUserId: s.actor.userId,
    })
    .where(and(eq(designs.id, data.id), eq(designs.revision, data.revision)))
    .returning({ revision: designs.revision, updatedAt: designs.updatedAt });
  if (!res.length) {
    throw new ConflictError(
      "Esta arte foi salva em outra sessão depois que você a abriu. Revise as alterações para não perder nada.",
    );
  }
  const saved = res[0]!;
  await maybeCheckpoint(s, {
    id: data.id,
    revision: saved.revision,
    document,
    width,
    height,
    thumbnail: data.thumbnail ?? current.design.thumbnail,
  });
  return saved;
}

/**
 * Primeira gravação no formato novo de uma arte antiga: o documento original
 * fica guardado como versão nomeada (não entra na limpeza automática), então a
 * conversão sempre pode ser desfeita pelo histórico.
 */
async function keepLegacyBeforeConversion(
  s: Scope,
  current: typeof designs.$inferSelect,
  next: Record<string, unknown>,
) {
  if (isDesignDocument(current.document) || !isDesignDocument(next)) return;
  const objects = (current.document as { objects?: unknown }).objects;
  if (!Array.isArray(objects) || !objects.length) return;
  await insertDesignVersion(
    s,
    {
      id: current.id,
      revision: current.revision,
      document: current.document,
      width: current.width,
      height: current.height,
      thumbnail: current.thumbnail,
    },
    { kind: "named", label: "Formato anterior (antes do novo editor)" },
  );
}

/* ------------------------------------------------------------------ */
/* Operações (lote com controle de revisão)                            */
/* ------------------------------------------------------------------ */

export const designOpsInput = z.object({
  designId: uuid,
  /** Revisão que a pessoa (ou o chat) viu; se outra sessão salvou depois, nada é aplicado. */
  revision: z.number().int().min(1),
  ops: z.array(designOpSchema).min(1).max(500),
  /** Cria uma versão nomeada com o estado anterior (ex.: "Antes da edição pelo chat"). */
  checkpointLabel: z.string().trim().min(1).max(80).optional(),
  /** Só calcula o resultado e os diffs (prévia), sem gravar. */
  dryRun: z.boolean().optional(),
});

/** Imagens referenciadas nas operações precisam ser arquivos acessíveis e do mesmo cliente da arte. */
async function assertOpAssets(s: Scope, ops: DesignOp[], designClientId: string | null) {
  const srcs = new Set<string>();
  const collect = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(collect);
    const r = o as Record<string, unknown>;
    if (typeof r.src === "string") srcs.add(r.src);
    Object.values(r).forEach(collect);
  };
  ops.forEach(collect);
  for (const src of srcs) {
    if (src.startsWith("data:image/")) continue;
    const versionId = versionIdOfSrc(src);
    if (!versionId) throw new ValidationError("Imagens precisam ser arquivos da plataforma (Arquivos).");
    const [row] = await s.db
      .select({ clientId: files.clientId })
      .from(fileVersions)
      .innerJoin(files, eq(files.id, fileVersions.fileId))
      .where(and(eq(fileVersions.id, versionId), fileScope(s.actor), isNull(files.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundError("Imagem não encontrada em Arquivos.");
    if (designClientId && row.clientId && row.clientId !== designClientId) {
      throw new ValidationError("A imagem pertence a outro cliente.");
    }
  }
}

/**
 * Aplica um lote de operações (lib/design-doc/ops) à arte salva, com controle
 * de revisão: se outra sessão salvou depois da revisão informada, nada é
 * aplicado (ConflictError). Base para o chat de edição por IA e integrações.
 */
export async function applyDesignOperations(s: Scope, raw: z.input<typeof designOpsInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const data = designOpsInput.parse(raw);
  const current = await getDesign(s, data.designId);
  const d = current.design;
  if (d.isTemplate) assertCan(s.actor, "templates.manage");
  if (d.revision !== data.revision) {
    throw new ConflictError("A arte mudou desde que foi lida. Carregue a versão atual e tente de novo.");
  }
  await assertOpAssets(s, data.ops, d.clientId);
  const { doc } = readDesignDocument(d.document, { width: d.width, height: d.height });
  let result: ReturnType<typeof applyOperations>;
  try {
    result = applyOperations(doc, data.ops);
  } catch (err) {
    if (err instanceof DesignOpError) throw new ValidationError(err.message);
    throw err;
  }
  const checked = checkDesignDocument(result.doc as unknown as Record<string, unknown>);
  const out = {
    diffs: result.diffs,
    inverse: result.inverse,
    applied: result.applied,
    document: checked.document as unknown as DesignDocument,
  };
  if (data.dryRun) return { ...out, revision: d.revision, saved: false as const };

  if (data.checkpointLabel) {
    await insertDesignVersion(
      s,
      {
        id: d.id,
        revision: d.revision,
        document: d.document,
        width: d.width,
        height: d.height,
        thumbnail: d.thumbnail,
      },
      { kind: "named", label: data.checkpointLabel },
    );
  } else {
    await keepLegacyBeforeConversion(s, d, checked.document);
  }
  const width = checked.size?.width ?? d.width;
  const height = checked.size?.height ?? d.height;
  const res = await s.db
    .update(designs)
    .set({
      document: checked.document,
      width,
      height,
      revision: sql`${designs.revision} + 1`,
      updatedByUserId: s.actor.userId,
    })
    .where(and(eq(designs.id, d.id), eq(designs.revision, data.revision)))
    .returning({ revision: designs.revision });
  if (!res.length) {
    throw new ConflictError(
      "A arte foi salva em outra sessão enquanto as alterações eram aplicadas. Nada foi alterado.",
    );
  }
  const revision = res[0]!.revision;
  await maybeCheckpoint(s, { id: d.id, revision, document: checked.document, width, height, thumbnail: d.thumbnail });
  const summary = result.diffs.length === 1 ? result.diffs[0]!.summary : `${result.diffs.length} alterações aplicadas`;
  await recordActivity(s, {
    action: "updated",
    entityType: "design",
    entityId: d.id,
    summary: `Arte "${d.name}": ${summary}`.slice(0, 300),
    event: false,
  });
  return { ...out, revision, saved: true as const };
}

/* ------------------------------------------------------------------ */
/* Modelos e imagens para o editor                                     */
/* ------------------------------------------------------------------ */

/**
 * Páginas de um template para inserir na arte aberta (painel Modelos). O
 * template precisa ser da agência ou do mesmo cliente da arte.
 */
export async function templatePagesForDesign(s: Scope, templateId: string, designId: string) {
  const target = await getDesign(s, designId);
  const t = await getDesign(s, templateId);
  if (!t.design.isTemplate) throw new ValidationError("O modelo escolhido não é um template.");
  assertTemplateForClient(t.design, target.design.clientId);
  const { doc } = readDesignDocument(t.design.document, { width: t.design.width, height: t.design.height });
  const clean = withoutOutputs(doc as unknown as Record<string, unknown>) as unknown as DesignDocument;
  return { name: t.design.name, pages: clean.pages, components: clean.components };
}

/** Templates que podem ser usados na arte (da agência ou do mesmo cliente). */
export async function templatesForDesign(s: Scope, designId: string) {
  const target = await getDesign(s, designId);
  const rows = await listDesigns(s, { templates: true });
  return rows
    .filter((t) => !t.clientId || t.clientId === target.design.clientId)
    .filter((t) => t.id !== designId)
    .map((t) => ({
      id: t.id,
      name: t.name,
      width: t.width,
      height: t.height,
      thumbnail: t.thumbnail,
      clientName: t.clientName,
    }));
}

/* ------------------------------------------------------------------ */
/* Versões (pontos de controle)                                        */
/* ------------------------------------------------------------------ */

export type DesignSnapshot = {
  id: string;
  revision: number;
  document: Record<string, unknown>;
  width: number;
  height: number;
  thumbnail: string | null;
};

/** Grava uma versão da arte e poda as automáticas além da retenção da organização. */
export async function insertDesignVersion(
  s: Scope,
  d: DesignSnapshot,
  opts: { kind: "auto" | "named" | "restore" | "conflict"; label?: string | null },
) {
  const [{ next } = { next: 1 }] = await s.db
    .select({ next: sql<number>`coalesce(max(${designVersions.versionNumber}), 0)::int + 1` })
    .from(designVersions)
    .where(eq(designVersions.designId, d.id));
  const [row] = await s.db
    .insert(designVersions)
    .values({
      organizationId: s.actor.orgId,
      designId: d.id,
      versionNumber: next,
      kind: opts.kind,
      label: opts.label ?? null,
      revision: d.revision,
      document: d.document,
      width: d.width,
      height: d.height,
      thumbnail: d.thumbnail,
      sizeBytes: Buffer.byteLength(JSON.stringify(d.document)),
      createdByUserId: s.actor.userId,
    })
    .returning({ id: designVersions.id, versionNumber: designVersions.versionNumber });
  const keep = s.actor.settings.storage.designVersionRetention;
  await s.db.execute(sql`
    delete from ${designVersions}
    where ${designVersions.designId} = ${d.id} and ${designVersions.kind} = 'auto'
      and ${designVersions.id} not in (
        select id from ${designVersions}
        where ${designVersions.designId} = ${d.id} and ${designVersions.kind} = 'auto'
        order by ${designVersions.versionNumber} desc limit ${keep}
      )`);
  return row!;
}

/** Revisões entre pontos de controle automáticos (além do intervalo de tempo da organização). */
const CHECKPOINT_EVERY_REVISIONS = 40;

/**
 * Ponto de controle automático: no máximo um a cada N minutos (ou a cada
 * CHECKPOINT_EVERY_REVISIONS salvamentos), nunca a cada movimento.
 */
export async function maybeCheckpoint(s: Scope, d: DesignSnapshot) {
  const [last] = await s.db
    .select({ createdAt: designVersions.createdAt, revision: designVersions.revision })
    .from(designVersions)
    .where(eq(designVersions.designId, d.id))
    .orderBy(desc(designVersions.versionNumber))
    .limit(1);
  const minutes = s.actor.settings.storage.versionCheckpointMinutes;
  const due =
    !last ||
    Date.now() - last.createdAt.getTime() >= minutes * 60_000 ||
    d.revision - last.revision >= CHECKPOINT_EVERY_REVISIONS;
  if (due) await insertDesignVersion(s, d, { kind: "auto", label: null });
  return due;
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
      document: withoutOutputs(src.design.document),
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

/** Devolve ao Estúdio uma arte arquivada. */
export async function unarchiveDesign(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const [d] = await s.db
    .select({ name: designs.name, isTemplate: designs.isTemplate })
    .from(designs)
    .where(and(eq(designs.id, id), designScope(s), isNotNull(designs.archivedAt)));
  if (!d) throw new NotFoundError("Arte não encontrada.");
  if (d.isTemplate && !can(s.actor, "templates.manage")) throw new ForbiddenError();
  await s.db.update(designs).set({ archivedAt: null }).where(eq(designs.id, id));
  await recordActivity(s, {
    action: "restored",
    entityType: "design",
    entityId: id,
    summary: `Arte "${d.name}" desarquivada`,
    event: false,
  });
}

/** Vincula o arquivo gerado pela exportação (nova versão em Arquivos). */
export async function linkDesignOutput(
  s: Scope,
  designId: string,
  fileId: string,
  versionId: string | null,
  opts: { primary?: boolean; label?: string } = {},
) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const d = await getDesign(s, designId);
  await assertFileAccess(s, fileId);
  const [file] = await s.db.select({ clientId: files.clientId }).from(files).where(eq(files.id, fileId));
  if (d.design.clientId && file?.clientId && file.clientId !== d.design.clientId) {
    throw new ValidationError("O arquivo pertence a outro cliente.");
  }
  // Em artes de várias páginas, a principal (primeira página) fica como o arquivo da arte.
  if (opts.primary !== false) await s.db.update(designs).set({ outputFileId: fileId }).where(eq(designs.id, designId));
  await recordActivity(s, {
    action: "exported",
    entityType: "design",
    entityId: designId,
    summary: `Arte "${d.design.name}"${opts.label ? ` (${opts.label})` : ""} exportada para Arquivos`,
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
