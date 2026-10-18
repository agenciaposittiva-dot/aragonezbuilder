import type { Metadata } from "next";
import { RequestForm } from "@/components/requests/request-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listTemplates } from "@/server/services/briefings";
import { clientOptions } from "@/server/services/clients";

export const metadata: Metadata = { title: "Nova solicitação" };

export default async function NewRequestPage({ params, searchParams }: PageProps<"/w/[org]/requests/new">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "requests.write" });
  const { clients, templates } = await inOrg(actor, async (s) => ({
    clients: await clientOptions(s),
    templates: await listTemplates(s, { activeOnly: true }),
  }));
  const base = `/w/${actor.orgSlug}/requests`;
  const fixed = typeof sp.clientId === "string" && clients.some((c) => c.id === sp.clientId) ? sp.clientId : undefined;
  return (
    <div className="mx-auto grid max-w-4xl gap-2">
      <Breadcrumbs items={[{ label: "Solicitações", href: base }, { label: "Nova" }]} />
      <PageHeader
        title="Nova solicitação"
        description="Registre a demanda com um briefing completo para a equipe começar sem idas e vindas."
      />
      <RequestForm
        clients={clients}
        fixedClientId={fixed}
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
