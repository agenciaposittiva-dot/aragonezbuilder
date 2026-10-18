/** Resolve um link configurado na personalização: caminhos internos ganham a base do portal. */
export function resolvePortalLink(url: string, base: string) {
  return url.startsWith("/") ? `${base}${url === "/" ? "" : url}` : url;
}

export function isExternalLink(url: string) {
  return /^https?:\/\//i.test(url);
}
