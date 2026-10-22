import { Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { RequestsTable } from "@/components/requests/requests-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES } from "@/lib/validators/requests";
import { can, inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { clientOptions } from "@/server/services/clients";
import { listRequests, requestStatusCounts } from "@/server/services/requests";
import { getShellCounts } from "@/server/services/shell";
import { parseRequestFilters } from "@/server/services/requests-page";

export const metadata: Metadata = { title: "Demandas" };

export default async function PortalRequestsPage({
  params,
  searchParams,
}: PageProps<"/portal/[org]/[client]/requests">) {
  const { org, client: clientSlug } = await params;
  const sp = await searchParams;
  const portal = await requirePortal(org, clientSlug, { permission: ["requests.read", "requests.write"] });
  const { actor } = portal;
  // O cliente não filtra por responsável da agência.
  const filters = { ...parseRequestFilters(sp), assigneeId: undefined };
  const data = await inOrg(actor, async (s) => ({
    list: await listRequests(s, filters),
    clients: actor.clientIds.length > 1 ? await clientOptions(s) : [],
    // Só os números deste cliente (o escopo do portal já restringe ao cliente do endereço).
    counts: await requestStatusCounts(s, portal.client.id),
    pendingApprovals: can(actor, "approvals.decide_client") ? (await getShellCounts(s)).badges.approvals : null,
  }));
  const c = data.counts;
  const kpis = [
    {
      key: "open",
      label: "Em aberto",
      value: (c.submitted ?? 0) + (c.triage ?? 0) + (c.in_progress ?? 0),
      href: `${portal.base}/requests?open=1`,
      active: sp.open === "1",
    },
    {
      key: "in_progress",
      label: "Em produção",
      value: c.in_progress ?? 0,
      href: `${portal.base}/requests?status=in_progress`,
      active: sp.status === "in_progress",
    },
    ...(data.pendingApprovals !== null
      ? [
          {
            key: "approvals",
            label: "Aguardando sua aprovação",
            value: data.pendingApprovals,
            href: `${portal.base}/approvals`,
            active: false,
          },
        ]
      : []),
    {
      key: "delivered",
      label: "Entregues",
      value: c.delivered ?? 0,
      href: `${portal.base}/requests?status=delivered`,
      active: sp.status === "delivered",
    },
  ];
  const base = `${portal.base}/requests`;
  const canCreate = can(actor, "requests.write") && actor.settings.portal.allowRequestCreation;
  const newButton = canCreate ? (
    <Button asChild variant="primary">
      <Link href={`${base}/new`}>
        <Plus /> Nova demanda
      </Link>
    </Button>
  ) : null;
  const filtered = ["q", "status", "clientId", "open"].some((k) => sp[k]);

  return (
    <>
      <PageHeader
        title="Demandas"
        description="Tudo o que a agência está fazendo para você: peça novas demandas com briefing e acompanhe o andamento de cada uma."
        actions={newButton}
      >
        <nav aria-label="Resumo das demandas" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpis.map((k) => (
            <Link
              key={k.key}
              href={k.href}
              aria-current={k.active ? "true" : undefined}
              data-testid={`portal-kpi-${k.key}`}
              className={cn(
                "rounded-xl border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong",
                k.active ? "border-accent ring-1 ring-accent" : "border-border",
              )}
            >
              <p
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  k.key === "approvals" && k.value ? "text-accent-text" : "",
                )}
              >
                {k.value}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">{k.label}</p>
            </Link>
          ))}
        </nav>
        {data.list.total || filtered ? (
          <FilterBar>
            <SearchFilter placeholder="Buscar por título ou nº" />
            <SelectFilter
              param="status"
              label="Status"
              options={REQUEST_STATUSES.map((st) => ({ value: st, label: REQUEST_STATUS_LABEL[st] }))}
            />
            {data.clients.length > 1 ? (
              <SelectFilter
                param="clientId"
                label="Marca"
                options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            ) : null}
            <ClearFilters keys={["q", "status", "clientId", "open"]} />
          </FilterBar>
        ) : null}
      </PageHeader>
      <Card>
        {data.list.total === 0 && !filtered ? (
          <EmptyState
            icon={Inbox}
            title="Nenhuma demanda ainda"
            description={
              canCreate
                ? "Abra uma demanda com o briefing. A agência recebe na hora e responde por aqui."
                : "As demandas registradas pela agência para você aparecem aqui."
            }
            action={newButton}
          />
        ) : (
          <RequestsTable
            rows={data.list.rows}
            total={data.list.total}
            page={data.list.page}
            pageSize={data.list.pageSize}
            basePath={base}
            detailBase={base}
            searchParams={sp}
            hideClient={data.clients.length <= 1}
            hideAssignee
          />
        )}
      </Card>
    </>
  );
}
