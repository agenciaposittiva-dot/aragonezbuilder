"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { OrgLogoEditor, uploadOrgLogo, type PendingLogo } from "@/components/brand/org-logo-editor";
import { toCrop } from "@/components/brand/logo-cropper";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { createOrganizationAction } from "./actions";

export function OnboardingForm({ needsAccessKey, logoMaxBytes }: { needsAccessKey: boolean; logoMaxBytes: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [logo, setLogo] = useState<PendingLogo | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  // Agência já criada, mas a logo não foi salva: oferece tentar de novo ou seguir sem ela.
  const [created, setCreated] = useState<{ slug: string; logoError: string } | null>(null);
  const [pending, start] = useTransition();

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function sendLogo(orgSlug: string, chosen: PendingLogo) {
    const res = await uploadOrgLogo(orgSlug, {
      file: chosen.file,
      crop: toCrop(chosen.img, chosen.crop),
      background: chosen.background,
    });
    if (res.ok) {
      router.push(`/w/${orgSlug}`);
      return true;
    }
    setCreated({ slug: orgSlug, logoError: res.error });
    return false;
  }

  if (created) {
    return (
      <div className="grid gap-4">
        <div role="alert" className="grid gap-1 rounded-lg border border-border bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="size-4 text-danger" /> A agência foi criada, mas a logo não foi salva.
          </p>
          <p className="text-sm text-fg-muted">{created.logoError}</p>
          <p className="text-xs text-fg-subtle">Você também pode enviar a logo depois em Configurações.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            loading={pending}
            disabled={!logo}
            onClick={() => start(async () => void (logo && (await sendLogo(created.slug, logo))))}
          >
            Tentar enviar de novo
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/w/${created.slug}`}>Continuar sem logo</Link>
          </Button>
        </div>
      </div>
    );
  }

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
            returnSlug: !!logo,
          });
          if (res && !res.ok) {
            setError(res.error);
            setErrors(res.fieldErrors ?? {});
            return;
          }
          if (res?.ok && logo) await sendLogo(res.data.slug, logo);
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
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">
          Logo da agência <span className="font-normal text-fg-subtle">(opcional)</span>
        </p>
        <OrgLogoEditor
          mode="deferred"
          orgName={name}
          src={null}
          maxBytes={logoMaxBytes}
          pending={logo}
          onPendingChange={setLogo}
        />
      </div>
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
        {pending && logo ? "Criando e enviando a logo…" : "Criar agência"}
      </Button>
    </form>
  );
}
