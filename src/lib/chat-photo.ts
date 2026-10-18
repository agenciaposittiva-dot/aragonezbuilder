/*
 * Foto de grupos e canais do chat (independente da foto de cada pessoa e da
 * logo da agência). A URL leva o hash do conteúdo: cada foto nova tem um
 * endereço novo, então o navegador nunca mostra a anterior por cache.
 */

/** Conversas que podem ter foto própria (diretas mostram a foto da outra pessoa). */
export const CHAT_PHOTO_KINDS = ["group", "channel"] as const;

export function chatPhotoPath(conversationId: string, hash: string) {
  return `/api/chat/photo/${conversationId}/${hash.slice(0, 32)}`;
}

/** Imagem exibida para a conversa: foto do grupo/canal, foto da outra pessoa (diretas) ou nada (ícone). */
export function conversationImage(c: {
  id: string;
  kind: string;
  imageHash?: string | null;
  otherImage?: string | null;
}): string | null {
  if (c.kind === "direct") return c.otherImage ?? null;
  if ((CHAT_PHOTO_KINDS as readonly string[]).includes(c.kind) && c.imageHash) return chatPhotoPath(c.id, c.imageHash);
  return null;
}
