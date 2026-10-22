import { Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientHeaderActions } from "@/components/clients/client-header-actions";
import { ClientStatusBadge } from "@/components/clients/client-status";
import { Avatar } from "@/components/ui/avatar";
import { Badge, STATUS_COLORS } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { cn } from "@/lib/utils";
import { NotFoundError } from "@/server/errors";
import { listClientCategories } from "@/server/services/client-categories";
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
      return {
        detail,
        members: await listInternalMembers(s),
        logoVersionId: logos.get(id) ?? null,
        categories: (await listClientCategories(s)).categories,
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { client, team } = data.detail;
  const base = `/w/${actor.orgSlug}/clients/${id}`;
  const lead = team.find((t) => t.role === "lead");
  const category = data.categories.find((c) => c.id === client.categoryId) ?? null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
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
                {category ? (
                  <Link
                    href={`/w/${actor.orgSlug}/clients?category=${category.id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-fg-muted hover:text-fg"
                    title="Ver clientes desta categoria"
                  >
                    <span className={cn("size-1.5 rounded-full", STATUS_COLORS[category.color]?.dot)} aria-hidden="true" />
                    {category.name}
                  </Link>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-sm text-fg-muted">
                {[client.industry, lead ? `Atendimento: ${lead.name}` : null].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can(actor, "designs.write") && can(actor, "ai.use") ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/w/${actor.orgSlug}/studio/gerar?clientId=${client.id}`}>
                  <Sparkles /> Gerar carrossel
                </Link>
              </Button>
            ) : null}
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
                categoryId: client.categoryId ?? "",
                archived: !!client.archivedAt,
              }}
              categories={data.categories.map((c) => ({ id: c.id, name: c.name }))}
              members={data.members.map((m) => ({ membershipId: m.membershipId, name: m.name }))}
              canWrite={can(actor, "clients.write")}
              canArchive={can(actor, "clients.archive")}
              canDelete={can(actor, "clients.delete")}
            />
          </div>
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
            ...(can(actor, "brand.read")
              ? [{ label: "Radar de Marca", href: `/w/${actor.orgSlug}/brand-radar?client=${client.id}` }]
              : []),
            { label: "Portal", href: `${base}/portal` },
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
