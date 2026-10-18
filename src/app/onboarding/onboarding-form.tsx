"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { createOrganizationAction } from "./actions";

export function OnboardingForm({ needsAccessKey }: { needsAccessKey: boolean }) {
  const [name, setName] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const effectiveSlug = slugTouched ? slug : slugify(name);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createOrganizationAction({
            name,
            slug: slugTouched ? effectiveSlug : undefined,
            accessKey: needsAccessKey ? accessKey : undefined,
          });
          if (res && !res.ok) {
            setError(res.error);
            setErrors(res.fieldErrors ?? {});
          }
        });
      }}
    >
      <Field label="Nome da agência" htmlFor="name" error={errors.name}>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
      </Field>
      <Field label="Endereço" htmlFor="slug" hint="Usado nos links da plataforma." error={errors.slug}>
        <div className="flex items-center rounded-md border border-border bg-surface-2 pl-3 text-sm text-fg-subtle shadow-xs focus-within:border-accent">
          <span className="shrink-0">/w/</span>
          <input
            id="slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            className="h-9 w-full min-w-0 bg-transparent pr-3 text-fg outline-none"
          />
        </div>
      </Field>
      {needsAccessKey ? (
        <Field
          label="Chave de acesso"
          htmlFor="accessKey"
          hint="Fornecida pelo administrador da plataforma. Quem recebeu convite não precisa criar agência."
          error={errors.accessKey}
        >
          <Input
            id="accessKey"
            type="password"
            autoComplete="off"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            required
          />
        </Field>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={name.trim().length < 2}>
        Criar agência
      </Button>
    </form>
  );
}
