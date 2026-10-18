import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { parseUserAvatarPath, userAvatarPath } from "@/lib/user-avatar";
import type { OrgLogoCrop } from "@/lib/org-logo";
import { withSystem } from "@/server/db";
import { memberships, organizations, user } from "@/server/db/schema";
import { env } from "@/server/env";
import { NotFoundError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import { renderOrgLogo } from "./org-logo";

/*
 * Foto de perfil. Mesmo processamento da logo (tipo real pelos bytes,
 * orientação, recorte quadrado, PNG 512×512 com transparência, sem
 * metadados), mas por pessoa: cada usuário só altera a própria foto (o id
 * vem sempre da sessão, nunca do pedido). Ordem segura: grava o arquivo,
 * troca a referência no perfil e só então apaga o arquivo anterior — que é
 * exclusivo da foto, nunca compartilhado com outros recursos.
 */

export function avatarStorageKey(userId: string, hash: string) {
  return `users/${userId}/avatar-${hash.slice(0, 32)}.png`;
}

async function deleteQuietly(key: string) {
  try {
    await getStorage().delete(key);
  } catch (err) {
    console.error("[foto-perfil] não foi possível apagar o arquivo antigo", key, err);
  }
}

async function currentImage(userId: string) {
  const [row] = await withSystem((tx) => tx.select({ image: user.image }).from(user).where(eq(user.id, userId)));
  if (!row) throw new NotFoundError("Conta não encontrada.");
  return row.image;
}

export async function saveUserAvatar(userId: string, input: { buffer: Buffer; crop?: OrgLogoCrop | null }) {
  const png = await renderOrgLogo(
    { buffer: input.buffer, crop: input.crop, background: "transparent" },
    { maxBytes: env.AVATAR_MAX_BYTES, subject: "a foto" },
  );
  const hash = createHash("sha256").update(png).digest("hex");
  const src = userAvatarPath(userId, hash);
  const before = await currentImage(userId);
  if (before === src) return { src, changed: false };

  const key = avatarStorageKey(userId, hash);
  await getStorage().put(key, png, { contentType: "image/png" });
  let previous: string | null;
  try {
    previous = await withSystem(async (tx) => {
      const [row] = await tx.select({ image: user.image }).from(user).where(eq(user.id, userId)).for("update");
      await tx.update(user).set({ image: src, updatedAt: new Date() }).where(eq(user.id, userId));
      return row?.image ?? null;
    });
  } catch (err) {
    await deleteQuietly(key);
    throw err;
  }
  const old = parseUserAvatarPath(previous);
  if (old && old.userId === userId && old.hash !== hash.slice(0, 32)) {
    await deleteQuietly(avatarStorageKey(userId, old.hash));
  }
  return { src, changed: true };
}

/** Remove a foto (volta às iniciais). Links externos (login social) também são limpos do perfil. */
export async function removeUserAvatar(userId: string) {
  const previous = await withSystem(async (tx) => {
    const [row] = await tx.select({ image: user.image }).from(user).where(eq(user.id, userId)).for("update");
    if (!row) throw new NotFoundError("Conta não encontrada.");
    if (!row.image) return null;
    await tx.update(user).set({ image: null, updatedAt: new Date() }).where(eq(user.id, userId));
    return row.image;
  });
  const old = parseUserAvatarPath(previous);
  if (old && old.userId === userId) await deleteQuietly(avatarStorageKey(userId, old.hash));
  return { removed: !!previous };
}

/**
 * Entrega a foto apenas se ela ainda é a atual daquela pessoa e se quem pede é
 * a própria pessoa ou trabalha com ela (vínculo ativo na mesma agência, fora
 * da lixeira). Para os demais, nada (404).
 */
export async function readUserAvatar(targetUserId: string, hash: string, requesterUserId: string) {
  const path = userAvatarPath(targetUserId, hash);
  if (!parseUserAvatarPath(path)) return null;
  const allowed = await withSystem(async (tx) => {
    const [target] = await tx.select({ image: user.image }).from(user).where(eq(user.id, targetUserId));
    if (!target || target.image !== path) return false;
    if (targetUserId === requesterUserId) return true;
    const mine = tx
      .select({ orgId: memberships.organizationId })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(eq(memberships.userId, requesterUserId), eq(memberships.status, "active"), isNull(organizations.deletedAt)),
      );
    const [shared] = await tx
      .select({ n: sql<number>`1` })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, targetUserId),
          eq(memberships.status, "active"),
          sql`${memberships.organizationId} in ${mine}`,
        ),
      )
      .limit(1);
    return !!shared;
  });
  if (!allowed) return null;
  try {
    return await getStorage().get(avatarStorageKey(targetUserId, hash));
  } catch (err) {
    console.error("[foto-perfil] arquivo indisponível", targetUserId, err);
    return null;
  }
}
