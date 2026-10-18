"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function LoginForm({
  next,
  reset,
  title = "Entrar",
  description = "Acesse o painel da sua agência ou a área do cliente.",
  inviteNote = "Acesso somente por convite. Não recebeu o seu? Fale com o administrador da sua organização.",
}: {
  next: string;
  reset?: boolean;
  title?: string;
  description?: string;
  /** Plataforma privada: não há cadastro aberto, só convites. */
  inviteNote?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
      rememberMe: form.get("remember") === "on",
    });
    setLoading(false);
    if (error) {
      setError(
        error.status === 429 ? "Muitas tentativas. Aguarde um minuto e tente de novo." : "E-mail ou senha incorretos.",
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      </div>
      {reset ? (
        <p className="rounded-md border border-border bg-success-soft px-3 py-2 text-sm text-success">
          Senha redefinida. Entre com a nova senha.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-fg-muted">
            <input type="checkbox" name="remember" defaultChecked className="size-4 accent-[var(--accent-text)]" />
            Manter conectado
          </label>
          <Link href="/forgot-password" className="text-accent-text hover:underline">
            Esqueci a senha
          </Link>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={loading}>
          Entrar
        </Button>
      </form>
      <p className="text-center text-xs text-fg-muted" data-testid="login-invite-note">
        {inviteNote}
      </p>
    </div>
  );
}
