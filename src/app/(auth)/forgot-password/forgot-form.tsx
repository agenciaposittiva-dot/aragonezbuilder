"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email")).trim(),
      redirectTo: "/reset-password",
    });
    setLoading(false);
    // Sempre a mesma resposta, exista ou não a conta (evita enumeração de e-mails).
    setSent(true);
  }

  if (sent) {
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Verifique o seu e-mail</h1>
        <p className="text-sm text-fg-muted">
          Se houver uma conta com esse endereço, enviamos um link para criar uma nova senha. O link vale por 1 hora.
        </p>
        <Link href="/login" className="text-sm font-medium text-accent-text hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Recuperar senha</h1>
        <p className="mt-1 text-sm text-fg-muted">Informe o e-mail da sua conta.</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={loading}>
          Enviar link
        </Button>
      </form>
      <Link href="/login" className="text-center text-sm text-fg-muted hover:text-fg">
        Voltar para o login
      </Link>
    </div>
  );
}
