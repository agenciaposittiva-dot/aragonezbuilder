import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/server/env";

/**
 * Criptografia simétrica (AES-256-GCM) para segredos guardados no banco,
 * como chaves de API de IA por organização. A chave vem de ENCRYPTION_KEY
 * (32 bytes em base64); sem ela, deriva-se uma chave do BETTER_AUTH_SECRET.
 */
function key(): Buffer {
  if (env.ENCRYPTION_KEY) {
    const k = Buffer.from(env.ENCRYPTION_KEY, "base64");
    if (k.length === 32) return k;
  }
  return createHash("sha256").update(`enc:${env.BETTER_AUTH_SECRET}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptSecret(token: string): string | null {
  try {
    const [v, iv, tag, data] = token.split(".");
    if (v !== "v1" || !iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Mostra só o final da chave (ex.: "••••a1b2"). */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null;
  return `••••${plain.slice(-4)}`;
}
