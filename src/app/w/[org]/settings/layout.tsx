import { PageHeader } from "@/components/ui/page-header";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { can } from "@/server/authz";
import { requireActor } from "@/server/auth/session";

export default async function SettingsLayout({ children, params }: LayoutProps<"/w/[org]/settings">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal" });
  const base = `/w/${actor.orgSlug}/settings`;
  const items = [
    ...(can(actor, "org.manage") ? [{ label: "Geral", href: base, exact: true }] : []),
    ...(can(actor, "roles.manage") ? [{ label: "Papéis e permissões", href: `${base}/roles` }] : []),
    ...(can(actor, "org.manage") ? [{ label: "Fluxos de status", href: `${base}/workflow` }] : []),
    ...(can(actor, "briefings.manage") ? [{ label: "Modelos de briefing", href: `${base}/briefings` }] : []),
    ...(can(actor, "ai.settings") ? [{ label: "Inteligência artificial", href: `${base}/ai` }] : []),
  ];
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Regras da organização: acesso, fluxos, briefings, limites e integrações."
      />
      <div className="mb-6 border-b border-border">
        <UnderlineTabs items={items} />
      </div>
      {children}
    </>
  );
}
