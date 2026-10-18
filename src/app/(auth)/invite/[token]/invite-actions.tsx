"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { acceptInvitationAction } from "./actions";

export function AcceptButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      <Button
        variant="primary"
        size="lg"
        loading={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptInvitationAction(token);
            if (res && !res.ok) setError(res.error);
          })
        }
      >
        Aceitar convite
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          await authClient.signOut();
          router.refresh();
        })
      }
    >
      Sair desta conta
    </Button>
  );
}

/** Cria a conta com o e-mail do convite e, em seguida, aceita. */
export function SignupAndAccept({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const name = String(f.get("name") ?? "").trim();
        const password = String(f.get("password") ?? "");
        if (name.length < 2) return setError("Informe o seu nome.");
        if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
        setError(null);
        start(async () => {
          const { error: signUpError } = await authClient.signUp.email({ name, email, password });
          if (signUpError) {
            setError(
              signUpError.code === "USER_ALREADY_EXISTS" || signUpError.status === 422
                ? "Já existe uma conta com este e-mail. Entre para aceitar o convite."
                : (signUpError.message ?? "Não foi possível criar a conta."),
            );
            return;
          }
          const res = await acceptInvitationAction(token);
          if (res && !res.ok) setError(res.error);
        });
      }}
    >
      <Field label="E-mail" htmlFor="inv-email">
        <Input id="inv-email" value={email} readOnly className="bg-surface-2 text-fg-muted" />
      </Field>
      <Field label="Seu nome" htmlFor="inv-name">
        <Input id="inv-name" name="name" autoComplete="name" required autoFocus />
      </Field>
      <Field label="Crie uma senha" htmlFor="inv-password" hint="Mínimo de 8 caracteres.">
        <Input id="inv-password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        Criar conta e aceitar
      </Button>
    </form>
  );
}
