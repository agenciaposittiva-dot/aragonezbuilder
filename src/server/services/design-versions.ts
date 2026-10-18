import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { designs, designVersions, user } from "@/server/db/schema";
import { assertCan, assertInternal, type Scope } from "@/server/authz";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { getDesign, insertDesignVersion } from "./designs";

/*
 * Histórico de versões das artes do Estúdio. Restaurar nunca apaga nada:
 * grava o estado atual como versão, aplica a versão escolhida e registra a
 * restauração como uma nova versão. Num conflito de edição as duas versões
 * (a do servidor e a da sessão que chegou depois) ficam no histórico.
 */

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

async function assertWritable(s: Scope, designId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.write");
  const d = await getDesign(s, designId);
  if (d.design.isTemplate) assertCan(s.actor, "templates.manage");
  return d.design;
}

function snapshotOf(d: typeof designs.$inferSelect) {
  return {
    id: d.id,
    revision: d.revision,
    document: d.document,
    width: d.width,
    height: d.height,
    thumbnail: d.thumbnail,
  };
}

export async function listDesignVersions(s: Scope, designId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "designs.read");
  await getDesign(s, designId);
  return s.db
    .select({
      id: designVersions.id,
      versionNumber: designVersions.versionNumber,
      kind: designVersions.kind,
      label: designVersions.label,
      revision: designVersions.revision,
      width: designVersions.width,
      height: designVersions.height,
      thumbnail: designVersions.thumbnail,
      sizeBytes: designVersions.sizeBytes,
      createdAt: designVersions.createdAt,
      createdByName: user.name,
    })
    .from(designVersions)
    .leftJoin(user, eq(user.id, designVersions.createdByUserId))
    .where(eq(designVersions.designId, designId))
    .orderBy(desc(designVersions.versionNumber))
    .limit(100);
}

export type DesignVersionRow = Awaited<ReturnType<typeof listDesignVersions>>[number];

async function loadVersion(s: Scope, versionId: string) {
  const [v] = await s.db.select().from(designVersions).where(eq(designVersions.id, versionId));
  if (!v) throw new NotFoundError("Versão não encontrada.");
  // O acesso à versão segue o acesso à arte (escopo de clientes do ator).
  await getDesign(s, v.designId);
  return v;
}

/** Cria agora uma versão nomeada a partir do estado salvo no servidor. */
export async function createNamedVersion(s: Scope, raw: { designId: string; label: string }) {
  const data = z
    .object({ designId: z.uuid(), label: z.string().trim().min(1, "Dê um nome à versão").max(80) })
    .parse(raw);
  const d = await assertWritable(s, data.designId);
  const v = await insertDesignVersion(s, snapshotOf(d), { kind: "named", label: data.label });
  await recordActivity(s, {
    action: "version_named",
    entityType: "design",
    entityId: d.id,
    summary: `Versão "${data.label}" salva na arte "${d.name}"`,
    event: false,
  });
  return v;
}

/** Restaura uma versão: o estado atual vira versão e a restauração também (histórico preservado). */
export async function restoreDesignVersion(s: Scope, versionId: string) {
  const v = await loadVersion(s, versionId);
  const d = await assertWritable(s, v.designId);
  await insertDesignVersion(s, snapshotOf(d), {
    kind: "auto",
    label: `Antes de restaurar a versão ${v.versionNumber}`,
  });
  const [updated] = await s.db
    .update(designs)
    .set({
      document: v.document,
      width: v.width,
      height: v.height,
      thumbnail: v.thumbnail,
      revision: sql`${designs.revision} + 1`,
      updatedByUserId: s.actor.userId,
    })
    .where(eq(designs.id, d.id))
    .returning();
  const restored = await insertDesignVersion(s, snapshotOf(updated!), {
    kind: "restore",
    label: `Restaurada da versão ${v.versionNumber}`,
  });
  await recordActivity(s, {
    action: "version_restored",
    entityType: "design",
    entityId: d.id,
    summary: `Arte "${d.name}" restaurada da versão ${v.versionNumber}`,
    event: false,
  });
  return {
    revision: updated!.revision,
    document: updated!.document,
    width: updated!.width,
    height: updated!.height,
    versionNumber: restored.versionNumber,
  };
}

/* ------------------------------------------------------------------ */
/* Comparação                                                          */
/* ------------------------------------------------------------------ */

type SceneObject = { uid?: string; type?: string; name?: string; text?: string; src?: string };

function objectsOf(doc: Record<string, unknown>): SceneObject[] {
  const list = (doc as { objects?: unknown }).objects;
  return Array.isArray(list) ? (list as SceneObject[]) : [];
}

function describe(o: SceneObject) {
  if (o.text) return `Texto “${o.text.slice(0, 60)}”`;
  if (o.name) return o.name;
  return o.type === "image" ? "Imagem" : (o.type ?? "Elemento");
}

/** Resumo das diferenças entre duas versões (ou entre uma versão e o estado atual). */
export async function compareDesignVersions(s: Scope, fromId: string, toId: string | "current") {
  const a = await loadVersion(s, fromId);
  const b =
    toId === "current"
      ? await getDesign(s, a.designId).then((d) => ({ ...d.design, versionNumber: null as number | null }))
      : await loadVersion(s, toId);
  if ("designId" in b && b.designId !== a.designId) {
    throw new ValidationError("As versões são de artes diferentes.");
  }
  const before = objectsOf(a.document);
  const after = objectsOf(b.document);
  const key = (o: SceneObject, i: number) => o.uid ?? `${o.type}:${i}`;
  const beforeMap = new Map(before.map((o, i) => [key(o, i), o]));
  const afterMap = new Map(after.map((o, i) => [key(o, i), o]));
  const added = [...afterMap.entries()].filter(([k]) => !beforeMap.has(k)).map(([, o]) => describe(o));
  const removed = [...beforeMap.entries()].filter(([k]) => !afterMap.has(k)).map(([, o]) => describe(o));
  const textChanged = [...afterMap.entries()]
    .filter(([k, o]) => beforeMap.has(k) && (beforeMap.get(k)!.text ?? null) !== (o.text ?? null))
    .map(([k, o]) => ({ from: beforeMap.get(k)!.text ?? "", to: o.text ?? "" }));
  const modified = [...afterMap.entries()].filter(
    ([k, o]) => beforeMap.has(k) && JSON.stringify(beforeMap.get(k)) !== JSON.stringify(o),
  ).length;
  return {
    from: {
      versionNumber: a.versionNumber,
      objects: before.length,
      width: a.width,
      height: a.height,
      thumbnail: a.thumbnail,
    },
    to: {
      versionNumber: "versionNumber" in b ? b.versionNumber : null,
      objects: after.length,
      width: b.width,
      height: b.height,
      thumbnail: b.thumbnail,
    },
    added,
    removed,
    textChanged,
    modified,
  };
}

/* ------------------------------------------------------------------ */
/* Conflito de edição                                                  */
/* ------------------------------------------------------------------ */

export const conflictInput = z.object({
  designId: z.uuid(),
  strategy: z.enum(["mine", "theirs"]),
  document: z.record(z.string(), z.unknown()),
  thumbnail: z.string().max(300_000).nullable().optional(),
});

/**
 * Resolve um conflito sem perder trabalho:
 * - "mine": a versão do servidor é guardada no histórico e a sua passa a valer;
 * - "theirs": a sua versão é guardada no histórico e o editor recarrega a do servidor.
 */
export async function resolveDesignConflict(s: Scope, raw: z.input<typeof conflictInput>) {
  const data = conflictInput.parse(raw);
  const d = await assertWritable(s, data.designId);
  if (Buffer.byteLength(JSON.stringify(data.document)) > MAX_DOCUMENT_BYTES) {
    throw new ValidationError("A arte ficou grande demais para salvar.");
  }
  const mine = { ...snapshotOf(d), document: data.document, thumbnail: data.thumbnail ?? d.thumbnail };
  if (data.strategy === "theirs") {
    const v = await insertDesignVersion(s, mine, { kind: "conflict", label: "Suas alterações (conflito de edição)" });
    await recordActivity(s, {
      action: "conflict_resolved",
      entityType: "design",
      entityId: d.id,
      summary: `Conflito na arte "${d.name}": versão do servidor mantida, alterações guardadas na versão ${v.versionNumber}`,
      event: false,
    });
    return { revision: d.revision, document: d.document, keptVersion: v.versionNumber };
  }
  const v = await insertDesignVersion(s, snapshotOf(d), {
    kind: "conflict",
    label: "Versão de outra sessão (conflito de edição)",
  });
  const [updated] = await s.db
    .update(designs)
    .set({
      document: data.document,
      ...(data.thumbnail !== undefined ? { thumbnail: data.thumbnail } : {}),
      revision: sql`${designs.revision} + 1`,
      updatedByUserId: s.actor.userId,
    })
    .where(and(eq(designs.id, d.id), eq(designs.revision, d.revision)))
    .returning();
  if (!updated) throw new ValidationError("A arte mudou de novo enquanto você decidia. Tente outra vez.");
  await recordActivity(s, {
    action: "conflict_resolved",
    entityType: "design",
    entityId: d.id,
    summary: `Conflito na arte "${d.name}": suas alterações aplicadas, a outra versão guardada na versão ${v.versionNumber}`,
    event: false,
  });
  return { revision: updated.revision, document: updated.document, keptVersion: v.versionNumber };
}
