import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/** Chave derivada do segredo da aplicação, exclusiva para links de download. */
function key() {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update("aragonez:file-download:v1").digest();
}

export type DownloadClaims = {
  key: string;
  exp: number;
  name: string;
  disposition: "inline" | "attachment";
  type: string;
};

function payload(c: DownloadClaims) {
  return [c.key, c.exp, c.name, c.disposition, c.type].join("\n");
}

export function signDownload(c: DownloadClaims): string {
  return createHmac("sha256", key()).update(payload(c)).digest("base64url");
}

/** Verifica assinatura (comparação em tempo constante) e validade do link. */
export function verifyDownload(c: DownloadClaims, sig: string, now = Date.now()): boolean {
  if (!sig || !Number.isFinite(c.exp) || c.exp * 1000 < now) return false;
  const expected = Buffer.from(signDownload(c));
  const given = Buffer.from(sig);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/** Link relativo e assinado servido por /api/files/download (drivers local e database). */
export function signedAppUrl(
  key: string,
  opts: { name: string; contentType: string; disposition: "inline" | "attachment"; expiresIn?: number },
) {
  const exp = Math.floor(Date.now() / 1000) + (opts.expiresIn ?? 300);
  const claims = { key, exp, name: opts.name, disposition: opts.disposition, type: opts.contentType };
  const qs = new URLSearchParams({
    key,
    exp: String(exp),
    name: opts.name,
    disposition: opts.disposition,
    type: opts.contentType,
    sig: signDownload(claims),
  });
  // URL relativa: funciona atrás de proxies e em qualquer domínio.
  return `/api/files/download?${qs.toString()}`;
}
