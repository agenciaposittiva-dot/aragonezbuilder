import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import sharp from "sharp";
import type { Scope } from "@/server/authz";
import { withSystem } from "@/server/db";
import { chatAttachments, chatMessages } from "@/server/db/schema";
import { LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { getStorage, safeFileName } from "@/server/storage";
import { isImage, mustDownload } from "./file-type";
import { validateUpload } from "./files";
import { loadAccess } from "./chat";

/*
 * Anexos do chat: mesma validação dos envios da Central de Arquivos (tamanho
 * pelo limite da organização, tipo real pelos bytes, tipos permitidos) e mesmo
 * armazenamento privado, mas acesso só para quem pode ler a conversa. O
 * arquivo é enviado antes da mensagem (fica "pendente") e preso a ela no envio.
 */

async function imageSize(buffer: Buffer, mime: string) {
  if (!isImage(mime)) return { width: null, height: null };
  try {
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

async function assertUploadRate(s: Scope) {
  const [row] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatAttachments)
    .where(
      and(
        eq(chatAttachments.uploadedByUserId, s.actor.userId),
        sql`${chatAttachments.createdAt} > now() - interval '60 seconds'`,
      ),
    );
  if ((row?.n ?? 0) >= 20) throw new LimitError("Muitos arquivos em pouco tempo. Aguarde um minuto.");
}

export async function uploadChatAttachment(
  s: Scope,
  conversationId: string,
  input: { buffer: Buffer; originalName: string },
) {
  const a = await loadAccess(s, conversationId);
  if (!a.canPost) throw new ValidationError("Você não pode enviar arquivos nesta conversa.");
  if (!a.participant && (a.conv.kind === "direct" || a.conv.kind === "group" || a.conv.isPrivate)) {
    throw new NotFoundError("Conversa não encontrada.");
  }
  await assertUploadRate(s);
  const sniffed = validateUpload(s, input);
  const name = input.originalName.trim().slice(0, 200) || `arquivo.${sniffed.ext}`;
  const { width, height } = await imageSize(input.buffer, sniffed.mime);
  const id = randomUUID();
  const key = `${s.actor.orgId}/chat/${a.conv.id}/${id}-${safeFileName(name)}`;
  const storage = getStorage();
  await storage.put(key, input.buffer, { contentType: sniffed.mime });
  try {
    await s.db.insert(chatAttachments).values({
      id,
      organizationId: s.actor.orgId,
      conversationId: a.conv.id,
      uploadedByUserId: s.actor.userId,
      name,
      mimeType: sniffed.mime,
      sizeBytes: input.buffer.length,
      storageKey: key,
      width,
      height,
    });
  } catch (err) {
    // Sem registro no banco, o objeto não pode ficar perdido no armazenamento.
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
  return { id, name, mimeType: sniffed.mime, sizeBytes: input.buffer.length, width, height };
}

/**
 * Link de download curto (assinado, poucos minutos) para quem pode ler a
 * conversa. Anexo pendente só é visível para quem enviou.
 */
export async function chatAttachmentUrl(s: Scope, attachmentId: string, opts: { download?: boolean } = {}) {
  const [row] = await s.db
    .select({ att: chatAttachments, deletedAt: chatMessages.deletedAt })
    .from(chatAttachments)
    .leftJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .where(eq(chatAttachments.id, attachmentId));
  if (!row || row.deletedAt) throw new NotFoundError("Arquivo não encontrado.");
  await loadAccess(s, row.att.conversationId);
  if (!row.att.messageId && row.att.uploadedByUserId !== s.actor.userId) {
    throw new NotFoundError("Arquivo não encontrado.");
  }
  const inline =
    !opts.download &&
    !mustDownload(row.att.mimeType) &&
    (/^(image\/(?!svg)|video\/|audio\/)/.test(row.att.mimeType) || row.att.mimeType === "application/pdf");
  return getStorage().signedUrl(row.att.storageKey, {
    name: row.att.name,
    contentType: row.att.mimeType,
    disposition: inline ? "inline" : "attachment",
    expiresIn: 300,
  });
}

/** Rotina diária: anexos enviados e nunca presos a uma mensagem (mais de 24 h). */
export async function cleanupPendingChatAttachments(olderThan = new Date(Date.now() - 24 * 3_600_000)) {
  const removed = await withSystem((tx) =>
    tx
      .delete(chatAttachments)
      .where(and(isNull(chatAttachments.messageId), lt(chatAttachments.createdAt, olderThan)))
      .returning({ key: chatAttachments.storageKey }),
  );
  let failed = 0;
  for (const r of removed) {
    await getStorage()
      .delete(r.key)
      .catch((err) => {
        failed++;
        console.error("[chat] falha ao apagar anexo pendente", r.key, err);
      });
  }
  return { removed: removed.length, failed };
}
