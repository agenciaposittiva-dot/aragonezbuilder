import { Clock, LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ApprovalLinkItems } from "@/components/approvals/approval-link-view";
import { APP_NAME } from "@/lib/constants";
import { portalAssetUrl } from "@/lib/portal-assets";
import { DEFAULT_PORTAL_SETTINGS } from "@/lib/portal-settings";
import { portalThemeStyle } from "@/lib/portal-theme";
import { essentialConfigPresent } from "@/server/config-ready";

export const metadata: Metadata = { title: "Aprovação de materiais", robots: { index: false, follow: false } };

const DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/**
 * Aprovação por link, sem conta: o cliente vê a versão atual de cada material
 * e aprova ou pede ajustes. O token autoriza só este conjunto de arquivos,
 * enquanto o link estiver ativo.
 */
export default async function ApprovalLinkPage({ params }: PageProps<"/aprovar/[token]">) {
  await connection();
  if (!essentialConfigPresent()) redirect("/setup");
  const { token } = await params;
  const [{ getApprovalLinkView }, { resolvePublicPortal }] = await Promise.all([
    import("@/server/services/approval-links"),
    import("@/server/services/client-portal"),
  ]);
  const view = await getApprovalLinkView(token);

  if (view.state !== "active") {
    const msg =
      view.state === "expired"
        ? "Este link de aprovação expirou. Peça um novo link à agência."
        : view.state === "revoked"
          ? "Este link foi desativado pela agência. Se ainda precisa aprovar algo, peça um novo link."
          : "Link de aprovação inválido. Confira se o endereço foi copiado inteiro.";
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg p-6 text-fg">
        <div className="max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
            {view.state === "expired" ? <Clock className="size-5" /> : <LinkIcon className="size-5" />}
          </span>
          <h1 className="text-lg font-semibold">
            {view.state === "invalid" ? "Link não encontrado" : `Aprovação de ${view.clientName}`}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">{msg}</p>
          {view.state !== "invalid" ? <p className="mt-4 text-xs text-fg-subtle">{view.orgName}</p> : null}
        </div>
      </main>
    );
  }

  const portal = await resolvePublicPortal(view.orgSlug, view.clientSlug).catch(() => null);
  const settings = portal?.settings ?? DEFAULT_PORTAL_SETTINGS;
  const logo = portal?.hasLogo ? portalAssetUrl(portal.client.id, "logo", { v: portal.version }) : null;
  const name = settings.displayName ?? view.clientName;
  const pending = view.items.filter((i) => i.pending).length;

  return (
    <div className="min-h-dvh bg-bg text-fg" style={portalThemeStyle(settings)}>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={name} className="max-h-10 w-auto max-w-[180px] object-contain" />
          ) : (
            <span className="text-base font-semibold tracking-tight">{name}</span>
          )}
          <span className="text-right text-xs text-fg-muted">Aprovação de materiais · {view.orgName}</span>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-fg-subtle uppercase">Para aprovar</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{view.label}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {pending
              ? `${pending} de ${view.items.length} material(is) aguardando sua decisão.`
              : "Tudo decidido. Obrigado!"}{" "}
            Link válido até {DATE.format(view.expiresAt)}.
          </p>
        </div>
        <ApprovalLinkItems token={token} items={view.items} />
      </main>
      <footer className="pb-8 text-center text-[11px] text-fg-subtle">
        {view.orgName} · {APP_NAME}
      </footer>
    </div>
  );
}
