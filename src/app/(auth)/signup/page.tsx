import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_ONLY_MESSAGE } from "@/lib/invite-only";

export const metadata: Metadata = { title: "Acesso por convite" };

/**
 * Não há cadastro aberto: quem chega por um link antigo de "Criar conta" vê o
 * aviso. A criação de contas também é recusada no servidor (ver signup-gate.ts).
 */
export default function SignupPage() {
  return (
    <div className="grid gap-4" data-testid="invite-only">
      <h1 className="text-xl font-semibold tracking-tight">Acesso somente por convite</h1>
      <p className="text-sm text-fg-muted">{INVITE_ONLY_MESSAGE}</p>
      <p className="text-sm text-fg-muted">
        Recebeu um convite? Abra o link do e-mail para criar a sua conta. Já tem conta? Entre normalmente.
      </p>
      <Link href="/login" className="text-sm font-medium text-accent-text hover:underline">
        Ir para o login
      </Link>
    </div>
  );
}
