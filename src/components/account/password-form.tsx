"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function PasswordForm() {
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      ref={form}
      className="grid gap-4 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const currentPassword = String(f.get("current") ?? "");
        const newPassword = String(f.get("next") ?? "");
        if (newPassword.length < 8) return setError("A nova senha precisa ter pelo menos 8 caracteres.");
        if (newPassword !== String(f.get("confirm") ?? "")) return setError("As senhas não conferem.");
        setError(null);
        start(async () => {
          const { error: err } = await authClient.changePassword({
            currentPassword,
            newPassword,
            revokeOtherSessions: true,
          });
          if (err) {
            setError(
              err.status === 400 || err.code === "INVALID_PASSWORD"
                ? "Senha atual incorreta."
                : (err.message ?? "Não foi possível alterar a senha."),
            );
            return;
          }
          form.current?.reset();
          toast.success("Senha alterada. As outras sessões foram encerradas.");
        });
      }}
    >
      <Field label="Senha atual" htmlFor="pw-current">
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Nova senha" htmlFor="pw-next" hint="Mínimo de 8 caracteres.">
        <Input id="pw-next" name="next" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirme a nova senha" htmlFor="pw-confirm">
        <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          Alterar senha
        </Button>
      </div>
    </form>
  );
}
