import "server-only";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { ConflictError, LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { clientIp, consumeRateLimit } from "@/server/rate-limit";
import { acceptInvitation, getInvitationByToken, hashToken } from "@/server/services/invitations";
import { auth } from "./index";
import { runAuthorizedSignup } from "./signup-gate";

const signupInput = z.object({
  name: z.string().trim().min(2, "Informe o seu nome.").max(120),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(128),
});

const STATE_MESSAGE = {
  expired: "Este convite expirou. Peça um novo convite a quem enviou.",
  revoked: "Este convite foi cancelado.",
  accepted: "Este convite já foi utilizado.",
} as const;

/** Mesma resposta para "já existe conta" e corridas: não confirma se um e-mail está cadastrado. */
const CANNOT_CREATE =
  "Não foi possível criar a conta com este convite. Se você já tem uma conta, entre com ela para aceitar o convite.";

/**
 * Único caminho para criar conta: valida o convite no servidor, cria a conta
 * com o e-mail DO CONVITE (nunca um e-mail vindo do navegador), aceita o
 * convite (papel, agência e clientes definidos por quem convidou) e abre a
 * sessão. Limita tentativas por IP e por convite.
 */
export async function signUpWithInvitation(
  token: string,
  raw: { name: string; password: string },
  headers: Headers,
): Promise<{ slug: string; kind: "internal" | "client" }> {
  const ip = clientIp(headers);
  const byIp = await consumeRateLimit(`invite-signup:ip:${ip}`, { windowSec: 600, max: 30 });
  const byToken = await consumeRateLimit(`invite-signup:token:${hashToken(String(token)).slice(0, 32)}`, {
    windowSec: 600,
    max: 6,
  });
  if (!byIp || !byToken) throw new LimitError("Muitas tentativas. Aguarde alguns minutos e tente de novo.");

  const data = signupInput.parse(raw);
  const invite = await getInvitationByToken(String(token));
  if (!invite) throw new NotFoundError("Convite inválido. Confira o link mais recente que você recebeu.");
  if (invite.state !== "valid") throw new ValidationError(STATE_MESSAGE[invite.state]);
  if (invite.userExists) throw new ConflictError(CANNOT_CREATE);

  let userId: string;
  try {
    const res = await runAuthorizedSignup(invite.email, () =>
      auth.api.signUpEmail({ body: { email: invite.email, name: data.name, password: data.password }, headers }),
    );
    userId = res.user.id;
  } catch (err) {
    if (isAPIError(err)) {
      const msg = String(err.body?.message ?? "");
      if (/password/i.test(msg)) throw new ValidationError("Use uma senha entre 8 e 128 caracteres.");
      throw new ConflictError(CANNOT_CREATE);
    }
    throw err;
  }
  const accepted = await acceptInvitation(String(token), { id: userId, email: invite.email });
  return { slug: accepted.slug, kind: accepted.kind };
}
