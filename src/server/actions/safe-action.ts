import "server-only";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { inOrg, type Scope } from "@/server/authz";
import { getActor, getSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function toActionError(err: unknown): ActionResult<never> {
  unstable_rethrow(err);
  if (err instanceof AppError) {
    return { ok: false, error: err.message, code: err.code, fieldErrors: err.fieldErrors };
  }
  if (err instanceof z.ZodError) {
    return { ok: false, error: "Revise os campos destacados.", code: "validation", fieldErrors: zodFieldErrors(err) };
  }
  const pg = err as { code?: string; constraint?: string };
  if (pg?.code === "23505") {
    return { ok: false, error: "Já existe um registro com esses dados.", code: "conflict" };
  }
  if (pg?.code === "23503") {
    return { ok: false, error: "Este registro está vinculado a outros dados.", code: "conflict" };
  }
  if (pg?.code === "42501") {
    return { ok: false, error: "Acesso negado.", code: "forbidden" };
  }
  console.error("[action] erro inesperado", err);
  return { ok: false, error: "Não foi possível concluir a operação. Tente novamente.", code: "internal" };
}

type Options = {
  /** Re-renderiza a rota atual após o sucesso (padrão: true). */
  refresh?: boolean;
};

/**
 * Cria uma Server Action protegida para uma organização:
 *  1. exige sessão válida e vínculo ativo com a organização (`orgSlug`);
 *  2. valida a entrada com Zod;
 *  3. executa o serviço numa transação restrita à organização (RLS);
 *  4. converte erros de domínio em respostas para a interface.
 * As permissões específicas são verificadas dentro de cada serviço.
 */
export function orgAction<S extends z.ZodType, R>(
  schema: S,
  handler: (s: Scope, input: z.output<S>) => Promise<R>,
  options: Options = {},
) {
  return async (orgSlug: string, input: z.input<S>): Promise<ActionResult<R>> => {
    try {
      const session = await getSession();
      if (!session) return { ok: false, error: "Sua sessão expirou. Entre novamente.", code: "unauthenticated" };
      const actor = await getActor(String(orgSlug));
      if (!actor) return { ok: false, error: "Acesso negado.", code: "forbidden" };
      const data = schema.parse(input);
      const result = await inOrg(actor, (s) => handler(s, data));
      if (options.refresh !== false) refresh();
      return { ok: true, data: result };
    } catch (err) {
      return toActionError(err);
    }
  };
}
