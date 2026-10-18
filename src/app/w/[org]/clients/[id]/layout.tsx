import { notFound } from "next/navigation";
import { ClientHeaderActions } from "@/components/clients/client-header-actions";
import { ClientStatusBadge } from "@/components/clients/client-status";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getClient } from "@/server/services/clients";
import { clientLogoVersions } from "@/server/services/files";
import { listInternalMembers } from "@/server/services/members";

export default async function ClientLayout({ children, params }: LayoutProps<"/w/[org]/clients/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      const detail = await getClient(s, id);
      const logos = detail.client.logoFileId ? await clientLogoVersions(s, [id]) : new Map<string, string>();
      return { detail, members: await listInternalMembers(s), logoVersionId: logos.get(id) ?? null };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { client, team } = data.detail;
  const base = `/w/${actor.orgSlug}/clients/${id}`;
  const lead = team.find((t) => t.role === "lead");

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <Breadcrumbs items={[{ label: "Clientes", href: `/w/${actor.orgSlug}/clients` }, { label: client.name }]} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar
              name={client.name}
              src={data.logoVersionId ? `/api/files/${data.logoVersionId}` : null}
              square
              size="xl"
              className={data.logoVersionId ? "bg-surface ring-1 ring-border [&_img]:object-contain" : undefined}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{client.name}</h1>
                <ClientStatusBadge status={client.status} />
                {client.archivedAt ? <Badge tone="warning">Arquivado</Badge> : null}
              </div>
              <p className="mt-0.5 truncate text-sm text-fg-muted">
                {[client.industry, lead ? `Atendimento: ${lead.name}` : null].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          </div>
          <ClientHeaderActions
            client={{
              id: client.id,
              name: client.name,
              legalName: client.legalName,
              document: client.document,
              email: client.email,
              phone: client.phone,
              website: client.website,
              industry: client.industry,
              address: client.address,
              status: client.status,
              notesInternal: client.notesInternal,
              archived: !!client.archivedAt,
            }}
            members={data.members.map((m) => ({ membershipId: m.membershipId, name: m.name }))}
            canWrite={can(actor, "clients.write")}
            canArchive={can(actor, "clients.archive")}
          />
        </div>
      </div>
      <div className="border-b border-border">
        <UnderlineTabs
          items={[
            { label: "Visão geral", href: base, exact: true },
            { label: "Projetos", href: `${base}/projects` },
            ...(can(actor, "requests.read") ? [{ label: "Solicitações", href: `${base}/requests` }] : []),
            ...(can(actor, "files.read") ? [{ label: "Arquivos", href: `${base}/files` }] : []),
            { label: "Marca", href: `${base}/brand` },
            ...(can(actor, "members.read") ? [{ label: "Convidados", href: `${base}/guests` }] : []),
            ...(can(actor, "finance.read") ? [{ label: "Financeiro", href: `${base}/finance` }] : []),
            { label: "Histórico", href: `${base}/history` },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
