import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/*
 * Cadastro somente por convite. Toda criação de conta pelo Better Auth (rota
 * pública /api/auth/sign-up/email, chamadas internas ou qualquer outro método
 * que crie usuário) é recusada, exceto dentro de `runAuthorizedSignup`, que só
 * o fluxo de convite chama depois de validar o token no servidor — e apenas
 * para o e-mail do convite. Um pedido vindo do navegador nunca entra aqui.
 */

const authorized = new AsyncLocalStorage<{ email: string }>();

export function runAuthorizedSignup<T>(email: string, fn: () => Promise<T>): Promise<T> {
  return authorized.run({ email: email.trim().toLowerCase() }, fn);
}

export function signupAuthorized(email: unknown): boolean {
  const ctx = authorized.getStore();
  return !!ctx && typeof email === "string" && email.trim().toLowerCase() === ctx.email;
}
