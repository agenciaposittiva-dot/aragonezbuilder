import "server-only";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveActor, type Actor } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import { organizations } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { auth } from "./index";

/** Ator para Route Handlers (equivalente ao requireActor das páginas). */
export async function routeActor(req: Request, orgSlug: string): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return null;
  return resolveActor(session.user.id, orgSlug);
}

export async function routeActorForOrgId(req: Request, orgId: string): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return null;
  const [org] = await withSystem((tx) =>
    tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
  );
  if (!org) return null;
  return resolveActor(session.user.id, org.slug);
}

const STATUS: Record<AppError["code"], number> = {
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  limit: 429,
  unauthenticated: 401,
};

export function jsonError(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json(
      { ok: false, error: err.message, code: err.code, fieldErrors: err.fieldErrors },
      { status: STATUS[err.code] },
    );
  }
  console.error("[route] erro inesperado", err);
  return NextResponse.json({ ok: false, error: "Não foi possível concluir a operação." }, { status: 500 });
}
