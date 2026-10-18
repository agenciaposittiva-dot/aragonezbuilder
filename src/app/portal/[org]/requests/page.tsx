import { Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { RequestsTable } from "@/components/requests/requests-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES } from "@/lib/validators/requests";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listRequests } from "@/server/services/requests";
import { parseRequestFilters } from "@/server/services/requests-page";

export const metadata: Metadata = { title: "Solicitações" };

export default async function PortalRequestsPage({ params, searchParams }: PageProps<"/portal/[org]/requests">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "client", permission: "requests.read" });
  // O cliente não filtra por responsável da agência.
  const filters = { ...parseRequestFilters(sp), assigneeId: undefined };
  const data = await inOrg(actor, async (s) => ({
    list: await listRequests(s, filters),
    clients: actor.clientIds.length > 1 ? await clientOptions(s) : [],
  }));
  const base = `/portal/${actor.orgSlug}/requests`;
  const canCreate = can(actor, "requests.write") && actor.settings.portal.allowRequestCreation;
  const newButton = canCreate ? (
    <Button asChild variant="primary">
      <Link href={`${base}/new`}>
        <Plus /> Nova solicitação
      </Link>
    </Button>
  ) : null;
  const filtered = ["q", "status", "clientId"].some((k) => sp[k]);

  return (
    <>
      <PageHeader
        title="Solicitações"
        description="Peça novas demandas com briefing e acompanhe o andamento de cada uma."
        actions={newButton}
      >
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
            <ClearFilters keys={["q", "status", "clientId"]} />
          </FilterBar>
        ) : null}
      </PageHeader>
      <Card>
        {data.list.total === 0 && !filtered ? (
          <EmptyState
            icon={Inbox}
            title="Nenhuma solicitação ainda"
            description={
              canCreate
                ? "Abra uma solicitação com o briefing da demanda. A agência recebe na hora e responde por aqui."
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
