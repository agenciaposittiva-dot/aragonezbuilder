import type { PortalAssetKey } from "./portal-settings";

/**
 * Endereço de uma imagem de marca do portal. A rota confere permissão e só
 * entrega arquivos de imagem do próprio cliente; `v` evita cache antigo após
 * uma nova publicação e `draft` é usado pela prévia (somente equipe).
 */
export function portalAssetUrl(
  clientId: string,
  key: PortalAssetKey,
  opts: { v?: number | string; draft?: boolean } = {},
) {
  const qs = new URLSearchParams();
  if (opts.v !== undefined) qs.set("v", String(opts.v));
  if (opts.draft) qs.set("draft", "1");
  const q = qs.toString();
  return `/api/portal-assets/${clientId}/${key}${q ? `?${q}` : ""}`;
}
