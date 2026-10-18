import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * Chave de acesso para criar novas agências (ACESS_KEY / ACCESS_KEY). Evita que
 * qualquer pessoa com o link crie organizações na sua instalação. Quem entra
 * por convite não precisa dela; a conta administradora (ARAGONEZ_ADMIN) também não.
 */
export function accessKeyRequired(email: string): boolean {
  if (!env.ACCESS_KEY) return false;
  return !env.ARAGONEZ_ADMIN || env.ARAGONEZ_ADMIN.trim().toLowerCase() !== email.trim().toLowerCase();
}

export function accessKeyMatches(given: string | undefined): boolean {
  if (!env.ACCESS_KEY) return true;
  const a = createHash("sha256")
    .update(given ?? "")
    .digest();
  const b = createHash("sha256").update(env.ACCESS_KEY).digest();
  return timingSafeEqual(a, b);
}
