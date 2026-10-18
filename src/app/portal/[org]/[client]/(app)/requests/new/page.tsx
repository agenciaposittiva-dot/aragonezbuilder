import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RequestForm } from "@/components/requests/request-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { listTemplates } from "@/server/services/briefings";
import { clientOptions } from "@/server/services/clients";

export const metadata: Metadata = { title: "Nova solicitação" };

export default async function PortalNewRequestPage({ params }: PageProps<"/portal/[org]/[client]/requests/new">) {
  const { org, client: clientSlug } = await params;
  const portal = await requirePortal(org, clientSlug, { permission: "requests.write" });
  const { actor } = portal;
  // A criação pelo cliente pode ser desligada nas configurações da organização.
  if (!actor.settings.portal.allowRequestCreation) notFound();
  const { clients, templates } = await inOrg(actor, async (s) => ({
    clients: await clientOptions(s),
    templates: await listTemplates(s, { activeOnly: true }),
  }));
  const base = `${portal.base}/requests`;
  return (
    <div className="mx-auto grid max-w-4xl gap-2">
      <Breadcrumbs items={[{ label: "Solicitações", href: base }, { label: "Nova" }]} />
      <PageHeader
        title="Nova solicitação"
        description="Quanto mais completo o briefing, mais rápido a agência começa. Você pode salvar como rascunho e enviar depois."
      />
      <RequestForm
        clients={clients}
        fixedClientId={clients.length === 1 ? clients[0]!.id : undefined}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          description: t.description,
          fields: t.fields,
        }))}
        detailBase={base}
      />
    </div>
  );
}
