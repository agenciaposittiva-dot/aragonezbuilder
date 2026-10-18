/*
 * Logo da agência (foto de perfil da organização). Compartilhado entre
 * servidor e interface: limites exibidos ao usuário e URL efetiva da logo.
 * A validação decisiva (tipo real, tamanho, dimensões) acontece no servidor.
 */

/** Lado da imagem final gravada (quadrada). */
export const ORG_LOGO_SIZE = 512;
/** Menor lado aceito na imagem original. */
export const ORG_LOGO_MIN_SIDE = 64;
/** Maior lado aceito na imagem original. */
export const ORG_LOGO_MAX_SIDE = 6000;
/** Limite de pixels da imagem original (protege a memória do servidor). */
export const ORG_LOGO_MAX_PIXELS = 36_000_000;

export const ORG_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ORG_LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

/** Fundo aplicado às áreas transparentes ou vazias do enquadramento. */
export const ORG_LOGO_BACKGROUNDS = {
  transparent: { label: "Transparente", color: null },
  white: { label: "Branco", color: "#ffffff" },
  dark: { label: "Escuro", color: "#121110" },
} as const;
export type OrgLogoBackground = keyof typeof ORG_LOGO_BACKGROUNDS;

/**
 * Recorte quadrado em frações da imagem original já orientada: `x` e `size`
 * relativos à largura, `y` relativo à altura. Pode ultrapassar a imagem
 * (zoom reduzido para caber uma logo larga): a sobra recebe o fundo escolhido.
 */
export type OrgLogoCrop = { x: number; y: number; size: number };

export function orgLogoPath(orgId: string, hash: string) {
  return `/api/org-logo/${orgId}?v=${hash.slice(0, 16)}`;
}

/** URL exibida: logo enviada > link externo (legado) > nenhuma (mostra iniciais). */
export function orgLogoSrc(org: {
  id: string;
  logoKey?: string | null;
  logoHash?: string | null;
  logoUrl?: string | null;
}): string | null {
  if (org.logoKey && org.logoHash) return orgLogoPath(org.id, org.logoHash);
  return org.logoUrl || null;
}
