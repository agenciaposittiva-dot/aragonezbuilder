import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { CHAT_PHOTO_KINDS, chatPhotoPath } from "@/lib/chat-photo";
import type { OrgLogoCrop } from "@/lib/org-logo";
import type { Scope } from "@/server/authz";
import { chatConversations } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import { recordActivity } from "./activity";
import { loadAccess, systemMessage } from "./chat";
import { renderOrgLogo } from "./org-logo";
import { queueStoragePurge } from "./trash";

/*
 * Foto de grupos e canais. Mesmas regras de "Configurar conversa": só quem
 * administra (criador/administradores do grupo; no canal, também quem tem
 * "chat.manage_channels"). Mesmo processamento da logo e da foto de perfil
 * (tipo real pelos bytes, recorte quadrado, PNG 512×512 sem metadados).
 * O arquivo é exclusivo da conversa: ao trocar ou remover, só o anterior
 * daquela conversa é apagado, depois que o banco confirmou a mudança.
 */

export function chatPhotoKey(orgId: string, conversationId: string, hash: string) {
  return `${orgId}/chat/${conversationId}/photo-${hash.slice(0, 32)}.png`;
}

async function deleteQuietly(key: string) {
  try {
    await getStorage().delete(key);
  } catch (err) {
    console.error("[chat] não foi possível apagar a foto anterior", key, err);
  }
}

async function editable(s: Scope, conversationId: string) {
  const a = await loadAccess(s, conversationId);
  if (!(CHAT_PHOTO_KINDS as readonly string[]).includes(a.conv.kind)) {
    throw new ValidationError("Só grupos e canais têm foto própria.");
  }
  if (!a.moderator) throw new ForbiddenError("Só quem administra o grupo pode alterar a foto.");
  return a;
}

export async function saveConversationPhoto(
  s: Scope,
  conversationId: string,
  input: { buffer: Buffer; crop?: OrgLogoCrop | null },
) {
  const a = await editable(s, conversationId);
  const png = await renderOrgLogo(
    { buffer: input.buffer, crop: input.crop, background: "transparent" },
    { maxBytes: env.CHAT_PHOTO_MAX_BYTES, subject: "a foto do grupo" },
  );
  const hash = createHash("sha256").update(png).digest("hex").slice(0, 32);
  const src = chatPhotoPath(a.conv.id, hash);
  if (a.conv.imageHash === hash && a.conv.imageKey) return { src, changed: false };

  const key = chatPhotoKey(s.actor.orgId, a.conv.id, hash);
  await getStorage().put(key, png, { contentType: "image/png" });
  let previous: string | null = null;
  try {
    const [row] = await s.db
      .select({ key: chatConversations.imageKey })
      .from(chatConversations)
      .where(eq(chatConversations.id, a.conv.id))
      .for("update");
    previous = row?.key ?? null;
    await s.db
      .update(chatConversations)
      .set({ imageKey: key, imageHash: hash, updatedAt: new Date() })
      .where(eq(chatConversations.id, a.conv.id));
    await systemMessage(
      s,
      a.conv.id,
      `<@${s.actor.userId}> ${previous ? "alterou" : "adicionou"} a foto ${a.conv.kind === "channel" ? "do canal" : "do grupo"}.`,
    );
    await recordActivity(s, {
      action: "chat_conversation_photo_updated",
      entityType: "chat_conversation",
      entityId: a.conv.id,
      summary: `Foto da conversa "${a.conv.name ?? ""}" ${previous ? "alterada" : "adicionada"}`,
      event: false,
    });
    // O arquivo anterior só é apagado depois que a troca foi gravada (evento processado após o commit).
    if (previous && previous !== key) await queueStoragePurge(s.db, s.actor.orgId, [previous]);
  } catch (err) {
    // A transação será desfeita: o arquivo novo não fica órfão.
    if (key !== previous) await deleteQuietly(key);
    throw err;
  }
  return { src, changed: true };
}

export async function removeConversationPhoto(s: Scope, conversationId: string) {
  const a = await editable(s, conversationId);
  if (!a.conv.imageKey) return { removed: false };
  const previous = a.conv.imageKey;
  await s.db
    .update(chatConversations)
    .set({ imageKey: null, imageHash: null, updatedAt: new Date() })
    .where(eq(chatConversations.id, a.conv.id));
  await systemMessage(
    s,
    a.conv.id,
    `<@${s.actor.userId}> removeu a foto ${a.conv.kind === "channel" ? "do canal" : "do grupo"}.`,
  );
  await recordActivity(s, {
    action: "chat_conversation_photo_removed",
    entityType: "chat_conversation",
    entityId: a.conv.id,
    summary: `Foto da conversa "${a.conv.name ?? ""}" removida`,
    event: false,
  });
  await queueStoragePurge(s.db, s.actor.orgId, [previous]);
  return { removed: true };
}

/** A foto atual, para quem pode ler a conversa; versões antigas e demais pedidos: "não encontrada". */
export async function readConversationPhoto(s: Scope, conversationId: string, hash: string) {
  const a = await loadAccess(s, conversationId);
  if (!a.conv.imageKey || !a.conv.imageHash || a.conv.imageHash !== hash) {
    throw new NotFoundError("Foto não encontrada.");
  }
  return getStorage().get(a.conv.imageKey);
}
