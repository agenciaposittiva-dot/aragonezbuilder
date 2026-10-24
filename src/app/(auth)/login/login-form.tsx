"use client";

import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function LoginForm({
  next,
  reset,
  title = "Entrar",
  description = "Acesse o painel da sua agência ou a área do cliente.",
  inviteNote = "Acesso somente por convite. Não recebeu o seu? Fale com o administrador da sua organização.",
  tone = "default",
  privacyUrl,
}: {
  next: string;
  reset?: boolean;
  title?: string;
  description?: string;
  /** Plataforma privada: não há cadastro aberto, só convites. */
  inviteNote?: string;
  /** "dark": sobre o painel escuro do login em cartão do portal. */
  tone?: "default" | "dark";
  /** Link "Política de privacidade" (portal do cliente). */
  privacyUrl?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const dark = tone === "dark";
  const input = cn(
    "pl-9",
    dark &&
      "border-white/15 bg-white/[0.06] text-white placeholder:text-white/40 hover:border-white/30 focus-visible:border-[var(--accent)]",
  );
  const icon = cn(
    "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2",
    dark ? "text-white/50" : "text-fg-subtle",
  );

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
    <div className={cn("grid gap-6", dark && "text-white [&_label]:text-white/85")}>
      <div>
        <h1 className={cn("font-semibold tracking-tight", dark ? "text-2xl" : "text-xl")}>{title}</h1>
        <p className={cn("mt-1 text-sm", dark ? "text-white/70" : "text-fg-muted")}>{description}</p>
      </div>
      {reset ? (
        <p className="rounded-md border border-border bg-success-soft px-3 py-2 text-sm text-success">
          Senha redefinida. Entre com a nova senha.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="E-mail" htmlFor="email">
          <div className="relative">
            <Mail className={icon} aria-hidden="true" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="email@exemplo.com"
              required
              autoFocus
              className={input}
            />
          </div>
        </Field>
        <Field label="Senha" htmlFor="password">
          <div className="relative">
            <LockKeyhole className={icon} aria-hidden="true" />
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Senha"
              required
              className={cn(input, "pr-10")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              className={cn(
                "absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md",
                dark ? "text-white/60 hover:text-white" : "text-fg-subtle hover:text-fg",
              )}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <div className="flex items-center justify-between gap-3 text-sm">
          <label className={cn("flex items-center gap-2", dark ? "text-white/80" : "text-fg-muted")}>
            <input type="checkbox" name="remember" defaultChecked className="size-4 accent-[var(--accent-text)]" />
            Manter conectado
          </label>
          <Link
            href="/forgot-password"
            className={cn("hover:underline", dark ? "text-[var(--portal-highlight)]" : "text-accent-text")}
          >
            Esqueci a senha
          </Link>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {/* No painel escuro, o botão usa a cor da marca do cliente (o preto padrão sumiria no fundo). */}
        <Button type="submit" variant={dark ? "accent" : "primary"} size="lg" loading={loading}>
          Entrar
        </Button>
      </form>
      <p className={cn("text-center text-xs", dark ? "text-white/60" : "text-fg-muted")} data-testid="login-invite-note">
        {inviteNote}
      </p>
      {privacyUrl ? (
        <a
          href={privacyUrl}
          target={privacyUrl.startsWith("/") ? undefined : "_blank"}
          rel="noopener noreferrer"
          className={cn("-mt-3 text-center text-xs hover:underline", dark ? "text-white/60" : "text-fg-muted")}
        >
          Política de Privacidade
        </a>
      ) : null}
    </div>
  );
}
