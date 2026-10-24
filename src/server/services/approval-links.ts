import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { approvalLinkDecisionInput, approvalLinkInput } from "@/lib/validators/approvals";
import { withOrg, withSystem } from "@/server/db";
import {
  approvalLinkItems,
  approvalLinks,
  approvals,
  clients,
  files,
  fileVersions,
  organizations,
  user,
} from "@/server/db/schema";
import { assertCan, assertClientAccess, assertInternal, clientScope, type Scope } from "@/server/authz";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { applyApprovalDecision } from "./approvals";

/*
 * Aprovação por link, sem conta: a equipe escolhe arquivos de UM cliente que
 * estão aguardando a aprovação dele e gera um link com validade. Quem abre o
 * link vê a versão atual de cada arquivo e aprova ou pede ajustes (com motivo),
 * informando o nome. A decisão vai para a MESMA aprovação pendente (mesmas
 * regras de versão, histórico e avisos à equipe). Só o hash do token fica no
 * banco; o link expira e pode ser revogado a qualquer momento.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function approvalLinkPath(token: string) {
  return `/aprovar/${token}`;
}

type LinkState = "active" | "expired" | "revoked";
function stateOf(link: { expiresAt: Date; revokedAt: Date | null }): LinkState {
  if (link.revokedAt) return "revoked";
  return link.expiresAt.getTime() <= Date.now() ? "expired" : "active";
}

/** Aprovações do cliente pendentes na versão ATUAL de cada arquivo. */
async function pendingClientApprovals(db: Scope["db"], fileRows: { id: string; currentVersionId: string | null }[]) {
  const versionIds = fileRows.map((f) => f.currentVersionId).filter((v): v is string => !!v);
  if (!versionIds.length) return new Map<string, typeof approvals.$inferSelect>();
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(inArray(approvals.fileVersionId, versionIds), eq(approvals.stage, "client"), eq(approvals.status, "pending")),
    );
  return new Map(rows.map((a) => [a.fileId, a]));
}

/* ------------------------------------------------------------------ */
/* Equipe da agência                                                   */
/* ------------------------------------------------------------------ */

/** Arquivos do cliente que estão aguardando a aprovação dele (candidatos a um link). */
export async function approvalLinkCandidates(s: Scope, clientId: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "approvals.request");
  await assertClientAccess(s, clientId);
  return s.db
    .select({
      fileId: files.id,
      name: files.name,
      versionId: files.currentVersionId,
      versionNumber: fileVersions.versionNumber,
      requestedAt: approvals.requestedAt,
    })
    .from(approvals)
    .innerJoin(files, eq(files.id, approvals.fileId))
    .innerJoin(fileVersions, eq(fileVersions.id, approvals.fileVersionId))
    .where(
      and(
        eq(files.clientId, clientId),
        isNull(files.deletedAt),
        eq(approvals.stage, "client"),
        eq(approvals.status, "pending"),
        sql`${approvals.fileVersionId} = ${files.currentVersionId}`,
      ),
    )
    .orderBy(asc(files.name))
    .limit(200);
}

export async function createApprovalLink(s: Scope, raw: z.input<typeof approvalLinkInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "approvals.request");
  const data = approvalLinkInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  const ids = [...new Set(data.fileIds)];
  const rows = await s.db
    .select({
      id: files.id,
      name: files.name,
      clientId: files.clientId,
      currentVersionId: files.currentVersionId,
      deletedAt: files.deletedAt,
    })
    .from(files)
    .where(inArray(files.id, ids));
  if (rows.length !== ids.length || rows.some((f) => f.deletedAt || f.clientId !== data.clientId)) {
    throw new ValidationError("Todos os arquivos precisam ser do cliente escolhido (e não estar na lixeira).");
  }
  const pending = await pendingClientApprovals(s.db, rows);
  const missing = rows.filter((f) => !pending.has(f.id));
  if (missing.length) {
    throw new ValidationError(
      `Envie para aprovação do cliente antes de incluir no link: ${missing.map((f) => f.name).join(", ")}.`,
    );
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + data.days * 86_400_000);
  const [link] = await s.db
    .insert(approvalLinks)
    .values({
      organizationId: s.actor.orgId,
      clientId: data.clientId,
      label: data.label,
      tokenHash: hashToken(token),
      expiresAt,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: approvalLinks.id });
  await s.db
    .insert(approvalLinkItems)
    .values(ids.map((fileId, position) => ({ organizationId: s.actor.orgId, linkId: link!.id, fileId, position })));
  await recordActivity(s, {
    action: "approval_link_created",
    entityType: "client",
    entityId: data.clientId,
    summary: `Link de aprovação criado: ${data.label} (${ids.length} arquivo(s), válido por ${data.days} dia(s))`,
    event: false,
  });
  return { id: link!.id, token, path: approvalLinkPath(token), expiresAt };
}

export async function listApprovalLinks(s: Scope, opts: { clientId?: string } = {}) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.read");
  const rows = await s.db
    .select({
      id: approvalLinks.id,
      label: approvalLinks.label,
      clientId: approvalLinks.clientId,
      clientName: clients.name,
      expiresAt: approvalLinks.expiresAt,
      revokedAt: approvalLinks.revokedAt,
      createdAt: approvalLinks.createdAt,
      lastViewedAt: approvalLinks.lastViewedAt,
      createdByName: user.name,
      items: sql<number>`(select count(*)::int from ${approvalLinkItems} i where i.link_id = ${approvalLinks.id})`,
      // Arquivos do link ainda aguardando decisão na versão atual.
      pending: sql<number>`(
        select count(*)::int from ${approvalLinkItems} i
        join ${files} f on f.id = i.file_id
        join ${approvals} a on a.file_version_id = f.current_version_id and a.stage = 'client' and a.status = 'pending'
        where i.link_id = ${approvalLinks.id} and f.deleted_at is null
      )`,
    })
    .from(approvalLinks)
    .innerJoin(clients, eq(clients.id, approvalLinks.clientId))
    .leftJoin(user, eq(user.id, approvalLinks.createdByUserId))
    .where(and(clientScope(s.actor), opts.clientId ? eq(approvalLinks.clientId, opts.clientId) : undefined))
    .orderBy(desc(approvalLinks.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r, state: stateOf(r) }));
}

export type ApprovalLinkRow = Awaited<ReturnType<typeof listApprovalLinks>>[number];

export async function revokeApprovalLink(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "approvals.request");
  const [link] = await s.db
    .select({ id: approvalLinks.id, clientId: approvalLinks.clientId, label: approvalLinks.label })
    .from(approvalLinks)
    .where(eq(approvalLinks.id, id));
  if (!link) throw new NotFoundError("Link não encontrado.");
  await assertClientAccess(s, link.clientId);
  await s.db
    .update(approvalLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(approvalLinks.id, id), isNull(approvalLinks.revokedAt)));
  await recordActivity(s, {
    action: "approval_link_revoked",
    entityType: "client",
    entityId: link.clientId,
    summary: `Link de aprovação revogado: ${link.label}`,
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Público (quem abre o link)                                          */
/* ------------------------------------------------------------------ */

/** Encontra o link pelo token (sem sessão). Token malformado ou desconhecido = null. */
async function findLink(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await withSystem((tx) =>
    tx
      .select({
        id: approvalLinks.id,
        organizationId: approvalLinks.organizationId,
        clientId: approvalLinks.clientId,
        label: approvalLinks.label,
        expiresAt: approvalLinks.expiresAt,
        revokedAt: approvalLinks.revokedAt,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientDeleted: clients.deletedAt,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        orgDeleted: organizations.deletedAt,
      })
      .from(approvalLinks)
      .innerJoin(clients, eq(clients.id, approvalLinks.clientId))
      .innerJoin(organizations, eq(organizations.id, approvalLinks.organizationId))
      .where(eq(approvalLinks.tokenHash, hashToken(token)))
      .limit(1),
  );
  if (!row || row.clientDeleted || row.orgDeleted) return null;
  return row;
}

export type ApprovalLinkView =
  | { state: "invalid" }
  | { state: "expired" | "revoked"; orgName: string; clientName: string }
  | {
      state: "active";
      label: string;
      expiresAt: Date;
      orgName: string;
      orgSlug: string;
      clientName: string;
      clientSlug: string;
      items: {
        fileId: string;
        name: string;
        mimeType: string | null;
        versionId: string | null;
        versionNumber: number | null;
        hasThumb: boolean;
        pending: { message: string | null; dueDate: string | null } | null;
        last: {
          status: "approved" | "changes_requested";
          decidedAt: Date | null;
          by: string | null;
          note: string | null;
        } | null;
      }[];
    };

export async function getApprovalLinkView(token: string): Promise<ApprovalLinkView> {
  const link = await findLink(token);
  if (!link) return { state: "invalid" };
  const state = stateOf(link);
  if (state !== "active") return { state, orgName: link.orgName, clientName: link.clientName };

  return withOrg(link.organizationId, async (tx) => {
    const rows = await tx
      .select({
        fileId: files.id,
        name: files.name,
        clientId: files.clientId,
        deletedAt: files.deletedAt,
        currentVersionId: files.currentVersionId,
        mimeType: fileVersions.mimeType,
        versionNumber: fileVersions.versionNumber,
        thumbnailKey: fileVersions.thumbnailKey,
      })
      .from(approvalLinkItems)
      .innerJoin(files, eq(files.id, approvalLinkItems.fileId))
      .leftJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
      .where(eq(approvalLinkItems.linkId, link.id))
      .orderBy(asc(approvalLinkItems.position));
    const visible = rows.filter((r) => !r.deletedAt && r.clientId === link.clientId);
    const pending = await pendingClientApprovals(
      tx,
      visible.map((r) => ({ id: r.fileId, currentVersionId: r.currentVersionId })),
    );
    const versionIds = visible.map((r) => r.currentVersionId).filter((v): v is string => !!v);
    const decided = versionIds.length
      ? await tx
          .select({
            fileId: approvals.fileId,
            status: approvals.status,
            decidedAt: approvals.decidedAt,
            decidedByName: approvals.decidedByName,
            deciderName: user.name,
            note: approvals.decisionNote,
          })
          .from(approvals)
          .leftJoin(user, eq(user.id, approvals.decidedByUserId))
          .where(
            and(
              inArray(approvals.fileVersionId, versionIds),
              eq(approvals.stage, "client"),
              inArray(approvals.status, ["approved", "changes_requested"]),
            ),
          )
          .orderBy(desc(approvals.decidedAt))
      : [];
    await tx.update(approvalLinks).set({ lastViewedAt: new Date() }).where(eq(approvalLinks.id, link.id));
    return {
      state: "active" as const,
      label: link.label,
      expiresAt: link.expiresAt,
      orgName: link.orgName,
      orgSlug: link.orgSlug,
      clientName: link.clientName,
      clientSlug: link.clientSlug,
      items: visible.map((r) => {
        const p = pending.get(r.fileId);
        const d = decided.find((x) => x.fileId === r.fileId);
        return {
          fileId: r.fileId,
          name: r.name,
          mimeType: r.mimeType,
          versionId: r.currentVersionId,
          versionNumber: r.versionNumber,
          hasThumb: !!r.thumbnailKey,
          pending: p ? { message: p.message, dueDate: p.dueDate } : null,
          last: d
            ? {
                status: d.status as "approved" | "changes_requested",
                decidedAt: d.decidedAt,
                by: d.decidedByName ?? d.deciderName,
                note: d.note,
              }
            : null,
        };
      }),
    };
  });
}

/**
 * Versão de arquivo que o link pode exibir: só a ATUAL de um arquivo do link,
 * enquanto o link está ativo. Devolve a chave de armazenamento para o link assinado.
 */
export async function approvalLinkVersion(token: string, versionId: string) {
  const link = await findLink(token);
  if (!link || stateOf(link) !== "active") return null;
  return withOrg(link.organizationId, async (tx) => {
    const [row] = await tx
      .select({
        storageKey: fileVersions.storageKey,
        thumbnailKey: fileVersions.thumbnailKey,
        mimeType: fileVersions.mimeType,
        originalName: fileVersions.originalName,
      })
      .from(approvalLinkItems)
      .innerJoin(files, eq(files.id, approvalLinkItems.fileId))
      .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
      .where(
        and(
          eq(approvalLinkItems.linkId, link.id),
          eq(files.currentVersionId, versionId),
          eq(files.clientId, link.clientId),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

/** Decisão de quem abriu o link (aprovar ou pedir ajustes, com o nome informado). */
export async function decideByApprovalLink(token: string, raw: z.input<typeof approvalLinkDecisionInput>) {
  const data = approvalLinkDecisionInput.parse(raw);
  const link = await findLink(token);
  if (!link) throw new NotFoundError("Link de aprovação inválido.");
  const state = stateOf(link);
  if (state !== "active") {
    throw new ValidationError(
      state === "expired"
        ? "Este link de aprovação expirou. Peça um novo à agência."
        : "Este link de aprovação foi desativado pela agência.",
    );
  }
  await withOrg(link.organizationId, async (tx) => {
    const [item] = await tx
      .select({ fileId: approvalLinkItems.fileId })
      .from(approvalLinkItems)
      .where(and(eq(approvalLinkItems.linkId, link.id), eq(approvalLinkItems.fileId, data.fileId)));
    if (!item) throw new NotFoundError("Arquivo não encontrado neste link.");
    const [file] = await tx.select().from(files).where(eq(files.id, data.fileId));
    if (!file || file.deletedAt || file.clientId !== link.clientId) throw new NotFoundError("Arquivo não encontrado.");
    const [approval] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.fileId, file.id), eq(approvals.stage, "client"), eq(approvals.status, "pending")))
      .orderBy(desc(approvals.requestedAt))
      .limit(1);
    if (!approval) {
      throw new ValidationError(
        "Este arquivo não está mais aguardando aprovação (já foi decidido ou mudou de versão).",
      );
    }
    // Sem conta: quem decide é registrado pelo nome informado (usuário nulo no histórico).
    await applyApprovalDecision(
      { db: tx, actor: { orgId: link.organizationId, userId: null } },
      approval,
      file,
      { decision: data.decision, note: data.note },
      { name: data.name },
    );
  });
}
