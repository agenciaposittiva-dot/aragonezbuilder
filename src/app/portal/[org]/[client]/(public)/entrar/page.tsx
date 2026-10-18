import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { PortalLoginView } from "@/components/portal/portal-login-view";
import { portalAssetUrl } from "@/lib/portal-assets";
import { essentialConfigPresent } from "@/server/config-ready";

type Props = PageProps<"/portal/[org]/[client]/entrar">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  if (!essentialConfigPresent()) return {};
  const { org, client } = await params;
  const { resolvePublicPortal } = await import("@/server/services/client-portal");
  const portal = await resolvePublicPortal(org, client);
  if (!portal) return { title: "Entrar", robots: { index: false } };
  const name = portal.settings.displayName ?? portal.client.name;
  return {
    title: `Entrar · ${name}`,
    robots: { index: false },
    ...(portal.settings.faviconFileId
      ? { icons: { icon: portalAssetUrl(portal.client.id, "favicon", { v: portal.version }) } }
      : {}),
  };
}

/**
 * Login do portal com a identidade do cliente. Usa a mesma autenticação da
 * plataforma: a página só muda a apresentação; o acesso ao cliente é
 * conferido depois do login, no portal.
 */
export default async function PortalLoginPage({ params, searchParams }: Props) {
  await connection();
  if (!essentialConfigPresent()) redirect("/setup");
  const { org, client } = await params;
  const sp = await searchParams;
  const [{ resolvePublicPortal }, { getSession }] = await Promise.all([
    import("@/server/services/client-portal"),
    import("@/server/auth/session"),
  ]);
  const portal = await resolvePublicPortal(org, client);
  const target = `/portal/${encodeURIComponent(org)}/${encodeURIComponent(client)}`;
  if (!portal) notFound();
  if (!portal.loginEnabled) redirect(`/login?next=${encodeURIComponent(target)}`);
  const denied = sp.negado === "1";
  if (!denied && (await getSession())) redirect(target);

  const { settings, client: c, org: o, version } = portal;
  const name = settings.displayName ?? c.name;
  return (
    <PortalLoginView
      settings={settings}
      name={name}
      orgName={o.name}
      logoUrl={portal.hasLogo ? portalAssetUrl(c.id, "logo", { v: version }) : null}
      logoAltUrl={settings.logoAltFileId ? portalAssetUrl(c.id, "logoAlt", { v: version }) : null}
      backgroundUrl={settings.login.backgroundFileId ? portalAssetUrl(c.id, "loginBackground", { v: version }) : null}
    >
      {denied ? (
        <p role="alert" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
          Esta conta não tem acesso a este portal. Entre com o e-mail que recebeu o convite.
        </p>
      ) : null}
      <LoginForm
        next={target}
        reset={sp.reset === "1"}
        title="Entrar no portal"
        description={`Use o e-mail do seu convite para acessar o espaço de ${name}.`}
        showSignup={false}
      />
    </PortalLoginView>
  );
}
