import "server-only";
import { NextResponse } from "next/server";
import { getActor, getSession } from "@/server/auth/session";
import type { Actor } from "@/server/authz";
import { AppError } from "@/server/errors";

/**
 * Proteção CSRF para Route Handlers que alteram dados: se o navegador enviou
 * `Origin`, ele precisa ser o próprio host da aplicação (as Server Actions já
 * fazem essa checagem automaticamente).
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Resolve sessão + ator para Route Handlers (respostas JSON em vez de redirecionar). */
export async function actorForRequest(orgSlug: string): Promise<{ actor: Actor } | { response: NextResponse }> {
  const session = await getSession();
  if (!session) return { response: jsonError("Sua sessão expirou. Entre novamente.", 401) };
  const actor = await getActor(orgSlug);
  if (!actor) return { response: jsonError("Acesso negado.", 403) };
  return { actor };
}

export function errorStatus(err: unknown): number {
  if (err instanceof AppError) {
    return { forbidden: 403, not_found: 404, validation: 422, conflict: 409, limit: 429, unauthenticated: 401 }[
      err.code
    ];
  }
  return 500;
}
