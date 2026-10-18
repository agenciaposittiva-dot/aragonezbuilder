"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setLoading(true);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email: String(form.get("email")).trim(),
      password,
    });
    setLoading(false);
    if (error) {
      setError(
        error.code === "USER_ALREADY_EXISTS" || error.status === 422
          ? "Já existe uma conta com este e-mail."
          : (error.message ?? "Não foi possível criar a conta."),
      );
      return;
    }
    router.replace("/onboarding");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Criar conta</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Você cria a sua agência no próximo passo. Recebeu um convite? Use o link do e-mail.
        </p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Seu nome" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required autoFocus />
        </Field>
        <Field label="E-mail profissional" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={loading}>
          Continuar
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-fg hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
