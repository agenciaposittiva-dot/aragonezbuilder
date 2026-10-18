/*
 * Foto de perfil da pessoa (diferente da logo da agência). Compartilhado entre
 * servidor e interface. A foto enviada é guardada no armazenamento privado e
 * `user.image` passa a apontar para a rota interna abaixo — assim todos os
 * avatares que já leem `user.image` (menu, chat, comentários, tarefas) mostram
 * a foto sem mudanças em cada tela.
 */

const PREFIX = "/api/user-avatar/";
const HASH_RE = /^[0-9a-f]{32}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function userAvatarPath(userId: string, hash: string) {
  return `${PREFIX}${userId}/${hash.slice(0, 32)}`;
}

/** Foto enviada pela plataforma (não um link externo de login social, por exemplo). */
export function parseUserAvatarPath(image: string | null | undefined): { userId: string; hash: string } | null {
  if (!image?.startsWith(PREFIX)) return null;
  const [userId, hash] = image.slice(PREFIX.length).split("/");
  if (!userId || !hash || !ID_RE.test(userId) || !HASH_RE.test(hash)) return null;
  return { userId, hash };
}
