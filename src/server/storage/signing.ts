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
