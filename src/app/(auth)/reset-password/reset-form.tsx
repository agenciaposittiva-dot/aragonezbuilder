"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== String(form.get("confirm"))) return setError("As senhas não conferem.");
    setLoading(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setLoading(false);
    if (error) return setError("O link expirou ou já foi usado. Peça um novo.");
    router.replace("/login?reset=1");
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Criar nova senha</h1>
        <p className="mt-1 text-sm text-fg-muted">Por segurança, as outras sessões abertas serão encerradas.</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Nova senha" htmlFor="password" hint="Mínimo de 8 caracteres.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
        </Field>
        <Field label="Confirme a senha" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={loading}>
          Salvar nova senha
        </Button>
      </form>
    </div>
  );
}
