"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const next = value.trim();
        if (next.length < 2) return toast.error("Informe o seu nome.");
        start(async () => {
          const { error } = await authClient.updateUser({ name: next });
          if (error) toast.error(error.message ?? "Não foi possível salvar.");
          else {
            toast.success("Perfil atualizado");
            router.refresh();
          }
        });
      }}
    >
      <Field label="Nome" htmlFor="acc-name">
        <Input
          id="acc-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="name"
          maxLength={100}
        />
      </Field>
      <Field label="E-mail" htmlFor="acc-email" hint="O e-mail identifica a sua conta e os seus convites.">
        <Input id="acc-email" value={email} readOnly className="bg-surface-2 text-fg-muted" />
      </Field>
      <div>
        <Button type="submit" variant="primary" loading={pending} disabled={value.trim() === name}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
