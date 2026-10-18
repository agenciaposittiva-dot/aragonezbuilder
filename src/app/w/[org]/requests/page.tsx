import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { RequestsTable } from "@/components/requests/requests-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BRIEFING_CATEGORIES, BRIEFING_CATEGORY_LABEL } from "@/lib/validators/briefings";
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES } from "@/lib/validators/requests";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listInternalMembers } from "@/server/services/members";
import { listRequests, requestStatusCounts } from "@/server/services/requests";
import { parseRequestFilters } from "@/server/services/requests-page";

export const metadata: Metadata = { title: "Solicitações" };

export default async function RequestsPage({ params, searchParams }: PageProps<"/w/[org]/requests">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "requests.read" });
  const filters = parseRequestFilters(sp);
  const data = await inOrg(actor, async (s) => ({
    list: await listRequests(s, filters),
    counts: await requestStatusCounts(s),
    clients: await clientOptions(s),
    members: await listInternalMembers(s),
  }));
  const base = `/w/${actor.orgSlug}/requests`;
  const toTriage = (data.counts.submitted ?? 0) + (data.counts.triage ?? 0);
  const newButton = can(actor, "requests.write") ? (
    <Button asChild variant="primary">
      <Link href={`${base}/new`}>
        <Plus /> Nova solicitação
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Solicitações"
        description={
          toTriage
            ? `${toTriage} aguardando triagem. Converta em projeto para iniciar a produção.`
            : "Demandas dos clientes com briefing, anexos e histórico."
        }
        actions={newButton}
      >
        <FilterBar>
          <SearchFilter placeholder="Buscar por título ou nº" />
          <SelectFilter
            param="status"
            label="Status"
            options={REQUEST_STATUSES.map((st) => ({
              value: st,
              label: `${REQUEST_STATUS_LABEL[st]}${data.counts[st] ? ` (${data.counts[st]})` : ""}`,
            }))}
          />
          <SelectFilter
            param="clientId"
            label="Cliente"
            options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectFilter
            param="category"
            label="Categoria"
            options={BRIEFING_CATEGORIES.map((c) => ({ value: c, label: BRIEFING_CATEGORY_LABEL[c] }))}
          />
          <SelectFilter
            param="assigneeId"
            label="Responsável"
            options={data.members.map((m) => ({ value: m.membershipId, label: m.name }))}
          />
          <ClearFilters keys={["q", "status", "clientId", "category", "assigneeId", "open"]} />
        </FilterBar>
      </PageHeader>
      <Card>
        <RequestsTable
          rows={data.list.rows}
          total={data.list.total}
          page={data.list.page}
          pageSize={data.list.pageSize}
          basePath={base}
          detailBase={base}
          searchParams={sp}
          emptyAction={newButton}
        />
      </Card>
    </>
  );
}
