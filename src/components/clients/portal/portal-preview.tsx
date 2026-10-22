"use client";

import { CheckCheck, FolderKanban, FolderOpen, Home, Inbox, Mail, Monitor, Phone, Smartphone } from "lucide-react";
import { useState } from "react";
import { PortalBanner } from "@/components/portal/portal-banner";
import { isExternalLink } from "@/components/portal/portal-links";
import { PortalLoginView } from "@/components/portal/portal-login-view";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PORTAL_SECTIONS, type PortalSettings } from "@/lib/portal-settings";
import { portalThemeStyle } from "@/lib/portal-theme";
import { cn } from "@/lib/utils";
import { ScaledFrame } from "./fields";

type Device = "desktop" | "mobile";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 780 };

/**
 * Prévia da personalização com os componentes reais do portal (login e
 * início), alimentada pelo estado do formulário, inclusive o que ainda não
 * foi salvo. É ilustrativa: o formulário não envia e os dados do início são
 * exemplos; o portal real mostra os dados do cliente.
 */
export function PortalPreview({
  settings,
  name,
  orgName,
  imageUrl,
  fallbackLogoUrl,
}: {
  settings: PortalSettings;
  name: string;
  orgName: string;
  /** URL de prévia de uma imagem do cliente (null se indisponível). */
  imageUrl: (fileId: string | null) => string | null;
  /** Logotipo cadastrado em Marca (usado quando o portal não define um próprio). */
  fallbackLogoUrl: string | null;
}) {
  const [tab, setTab] = useState<"login" | "home">("login");
  const [device, setDevice] = useState<Device>("desktop");
  const frame = device === "desktop" ? DESKTOP : MOBILE;
  const logoUrl = imageUrl(settings.logoFileId) ?? fallbackLogoUrl;
  const logoAltUrl = imageUrl(settings.logoAltFileId);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "home")}>
          <TabsList aria-label="Tela da prévia">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="home">Início</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={device} onValueChange={(v) => setDevice(v as Device)}>
          <TabsList aria-label="Dispositivo">
            <TabsTrigger value="desktop">
              <Monitor /> Desktop
            </TabsTrigger>
            <TabsTrigger value="mobile">
              <Smartphone /> Celular
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <ScaledFrame
        key={`${tab}-${device}`}
        width={frame.width}
        height={tab === "home" && device === "desktop" ? 900 : frame.height}
        maxHeight={device === "mobile" ? 640 : undefined}
        className={device === "mobile" ? "max-w-[360px] justify-self-center" : undefined}
      >
        {tab === "login" ? (
          <PortalLoginView
            frame={device}
            settings={settings}
            name={name}
            orgName={orgName}
            logoUrl={logoUrl}
            logoAltUrl={logoAltUrl}
            backgroundUrl={imageUrl(settings.login.backgroundFileId)}
          >
            <SampleLoginForm
              name={name}
              dark={settings.login.layout === "card"}
              privacy={!!settings.login.privacyUrl}
            />
          </PortalLoginView>
        ) : (
          <SampleHome
            settings={settings}
            name={name}
            orgName={orgName}
            logoUrl={logoUrl}
            logoAltUrl={logoAltUrl}
            bannerUrl={imageUrl(settings.banner.imageFileId)}
            mobile={device === "mobile"}
          />
        )}
      </ScaledFrame>
      <p className="text-xs text-fg-subtle">
        Prévia ilustrativa: o formulário não envia e os números do início são exemplos. Publique para valer no portal.
      </p>
    </div>
  );
}

function SampleLoginForm({ name, dark, privacy }: { name: string; dark: boolean; privacy: boolean }) {
  const field = dark ? "border-white/15 bg-white/[0.06] text-white placeholder:text-white/40" : undefined;
  return (
    <div className={cn("grid gap-5", dark && "text-white")} aria-label="Prévia do formulário de login">
      <div>
        <div className="flex items-center gap-2">
          <h1 className={cn("font-semibold tracking-tight", dark ? "text-2xl" : "text-xl")}>
            {dark ? "Bem-vindo" : "Entrar no portal"}
          </h1>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg-muted">Prévia</span>
        </div>
        <p className={cn("mt-1 text-sm", dark ? "text-white/70" : "text-fg-muted")}>
          {dark
            ? `Digite seu e-mail e senha para acessar o espaço de ${name}.`
            : `Use o e-mail do seu convite para acessar o espaço de ${name}.`}
        </p>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">E-mail</span>
        <Input disabled placeholder="email@exemplo.com" className={field} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Senha</span>
        <Input disabled type="password" placeholder="••••••••" className={field} />
      </div>
      <span className={cn("text-sm", dark ? "text-[var(--portal-highlight)]" : "text-accent-text")}>Esqueci a senha</span>
      <Button type="button" variant={dark ? "accent" : "primary"} size="lg" disabled className="disabled:opacity-100">
        Entrar
      </Button>
      {privacy ? (
        <span className={cn("text-center text-xs", dark ? "text-white/60" : "text-fg-muted")}>Política de Privacidade</span>
      ) : null}
    </div>
  );
}

function SampleHome({
  settings,
  name,
  orgName,
  logoUrl,
  logoAltUrl,
  bannerUrl,
  mobile,
}: {
  settings: PortalSettings;
  name: string;
  orgName: string;
  logoUrl: string | null;
  logoAltUrl: string | null;
  bannerUrl: string | null;
  mobile: boolean;
}) {
  const sec = settings.sections;
  const nav = [
    { label: "Início", icon: Home },
    { label: "Aprovações", icon: CheckCheck },
    { label: "Solicitações", icon: Inbox },
    { label: "Projetos", icon: FolderKanban },
    { label: "Materiais", icon: FolderOpen },
  ];
  const stats = [
    sec.approvals && { label: PORTAL_SECTIONS.approvals, value: 2 },
    sec.requests && { label: PORTAL_SECTIONS.requests, value: 3 },
    sec.projects && { label: PORTAL_SECTIONS.projects, value: 1 },
    sec.files && { label: PORTAL_SECTIONS.files, value: 8 },
  ].filter(Boolean) as { label: string; value: number }[];
  const c = settings.contact;
  const hasContact = sec.contact && (c.name || c.email || c.phone || c.whatsapp || c.hours || c.note);

  return (
    <div className="h-full overflow-hidden bg-bg text-fg" style={portalThemeStyle(settings)}>
      <header className="border-b border-border bg-surface">
        <div className={cn("flex h-14 items-center gap-2.5", mobile ? "px-4" : "px-8")}>
          <Avatar
            name={name}
            src={logoUrl}
            square
            className={logoUrl ? "bg-surface ring-1 ring-border [&_img]:object-contain" : undefined}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm leading-tight font-semibold">{name}</span>
            <span className="block truncate text-[11px] leading-tight text-fg-muted">Área do cliente · {orgName}</span>
          </span>
        </div>
        <nav className={cn("flex gap-1 overflow-hidden", mobile ? "px-2" : "px-6")} aria-hidden="true">
          {nav.map((n, i) => (
            <span
              key={n.label}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-fg-muted",
                i === 0 && "border-accent text-fg",
              )}
            >
              <n.icon className="size-4" />
              {n.label}
            </span>
          ))}
        </nav>
      </header>
      <main className={cn("grid gap-5", mobile ? "p-4" : "px-8 py-6")}>
        {sec.banner && settings.banner.enabled ? (
          <PortalBanner
            preview
            settings={settings}
            name={name}
            base=""
            imageUrl={bannerUrl}
            logoUrl={logoAltUrl ?? logoUrl}
            fallbackTitle="Olá, Paula"
            fallbackText={`Acompanhe aqui o que a ${orgName} está produzindo para ${name}.`}
            frameWidth={mobile ? MOBILE.width : DESKTOP.width}
          />
        ) : null}
        {settings.actions.length ? (
          <div className="flex flex-wrap gap-2">
            {settings.actions.map((a, i) => (
              <span
                key={i}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium",
                  a.style === "secondary"
                    ? "border border-border bg-surface text-fg"
                    : "bg-accent text-accent-fg shadow-xs",
                )}
              >
                {a.label || "Botão"}
              </span>
            ))}
          </div>
        ) : null}
        {sec.stats && stats.length ? (
          <div className={cn("grid gap-3", mobile ? "grid-cols-2" : "grid-cols-4")}>
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-xs font-medium text-fg-muted">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{s.value}</p>
              </div>
            ))}
          </div>
        ) : null}
        <div className={cn("grid gap-4", !mobile && "grid-cols-[1fr_320px]")}>
          <div className="grid content-start gap-4">
            {sec.approvals ? <SampleCard title={PORTAL_SECTIONS.approvals} rows={2} /> : null}
            {sec.deliveries ? <SampleCard title={PORTAL_SECTIONS.deliveries} rows={2} /> : null}
          </div>
          <div className="grid content-start gap-4">
            {sec.deadlines ? <SampleCard title={PORTAL_SECTIONS.deadlines} rows={2} /> : null}
            {sec.links && settings.links.length ? (
              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-sm font-semibold">{PORTAL_SECTIONS.links}</p>
                <ul className="mt-2 grid gap-1.5">
                  {settings.links.map((l, i) => (
                    <li key={i} className="truncate text-sm text-accent-text">
                      {l.label || l.url}
                      {isExternalLink(l.url) ? " ↗" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {hasContact ? (
              <div className="rounded-xl border border-border bg-surface p-4 text-sm">
                <p className="font-semibold">{PORTAL_SECTIONS.contact}</p>
                {c.name ? <p className="mt-2 font-medium">{c.name}</p> : null}
                {c.email ? (
                  <p className="mt-1 flex items-center gap-1.5 text-fg-muted">
                    <Mail className="size-3.5" /> {c.email}
                  </p>
                ) : null}
                {c.phone || c.whatsapp ? (
                  <p className="mt-1 flex items-center gap-1.5 text-fg-muted">
                    <Phone className="size-3.5" />{" "}
                    {[c.phone, c.whatsapp && `WhatsApp ${c.whatsapp}`].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {c.hours ? <p className="mt-1 text-fg-muted">{c.hours}</p> : null}
                {c.note ? <p className="mt-1 text-fg-subtle">{c.note}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function SampleCard({ title, rows }: { title: string; rows: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 grid gap-3" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="size-9 shrink-0 rounded-md bg-surface-3" />
            <span className="grid flex-1 gap-1.5">
              <span className="h-2.5 w-3/5 rounded-full bg-surface-3" />
              <span className="h-2 w-2/5 rounded-full bg-surface-2" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
