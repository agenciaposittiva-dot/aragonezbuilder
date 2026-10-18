import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/server/auth/session";
import { getInvitationByToken } from "@/server/services/invitations";
import { AcceptButton, SignOutButton, SignupAndAccept } from "./invite-actions";

export const metadata: Metadata = { title: "Convite" };

const STATE_TEXT = {
  expired: {
    title: "Convite expirado",
    body: "Este convite passou da validade. Peça um novo convite a quem enviou.",
  },
  revoked: { title: "Convite cancelado", body: "Este convite foi cancelado pela organização." },
  accepted: { title: "Convite já utilizado", body: "Este convite já foi aceito. Entre na sua conta para acessar." },
} as const;

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await getInvitationByToken(token);

  if (!invite) {
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Convite inválido</h1>
        <p className="text-sm text-fg-muted">
          O link está incompleto ou foi substituído por um novo. Confira o e-mail mais recente.
        </p>
        <Link href="/login" className="text-sm font-medium text-accent-text hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  if (invite.state !== "valid") {
    const t = STATE_TEXT[invite.state];
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-fg-muted">{t.body}</p>
        <Link href="/login" className="text-sm font-medium text-accent-text hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  const session = await getSession();
  const sameEmail = session && session.user.email.toLowerCase() === invite.email.toLowerCase();
  const where = invite.roleKind === "client" ? "a área do cliente de" : "a equipe de";

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Convite</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Convite para {where} {invite.orgName}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          Papel: <span className="font-medium text-fg">{invite.roleName}</span> · {invite.email}
        </p>
      </div>

      {session ? (
        sameEmail ? (
          <AcceptButton token={token} />
        ) : (
          <div className="grid gap-3">
            <p className="rounded-md border border-border bg-warning-soft px-3 py-2 text-sm text-warning">
              Você está conectado como {session.user.email}, mas o convite é para {invite.email}. Saia e entre com a
              conta certa.
            </p>
            <SignOutButton />
          </div>
        )
      ) : invite.userExists ? (
        <div className="grid gap-3">
          <p className="text-sm text-fg-muted">Já existe uma conta com {invite.email}. Entre para aceitar o convite.</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
          >
            Entrar e aceitar
          </Link>
        </div>
      ) : (
        <SignupAndAccept token={token} email={invite.email} />
      )}
    </div>
  );
}
