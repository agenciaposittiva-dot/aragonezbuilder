import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inOrg, type Scope } from "@/server/authz";
import { AppError } from "@/server/errors";
import { processEventsInBackground } from "@/server/events/inline";
import { actorForRequest, errorStatus, isSameOrigin, jsonError } from "@/server/http";

/**
 * Execução padrão das rotas do chat: sessão + vínculo com a organização,
 * proteção de origem nas alterações, transação restrita à organização (RLS)
 * e erros de domínio convertidos em JSON ({ ok:false, error, code }).
 */
export async function chatHandler<T>(
  req: Request,
  orgSlug: string | null | undefined,
  fn: (s: Scope) => Promise<T>,
  opts: { mutating?: boolean } = {},
) {
  if (opts.mutating && !isSameOrigin(req)) return jsonError("Origem não permitida.", 403);
  if (!orgSlug) return jsonError("Organização não informada.", 400);
  const resolved = await actorForRequest(orgSlug);
  if ("response" in resolved) return resolved.response;
  try {
    const data = await inOrg(resolved.actor, fn);
    if (opts.mutating) processEventsInBackground();
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) {
      return jsonError(err.message, errorStatus(err), { code: err.code, fieldErrors: err.fieldErrors });
    }
    if (err instanceof z.ZodError) return jsonError("Pedido inválido.", 422, { code: "validation" });
    console.error("[chat] erro inesperado", err);
    return jsonError("Não foi possível concluir a operação.", 500);
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = (await req.json().catch(() => null)) as unknown;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");
