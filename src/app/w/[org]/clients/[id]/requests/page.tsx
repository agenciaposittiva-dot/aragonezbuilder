import { Plus } from "lucide-react";
import Link from "next/link";
import { FilterBar, SelectFilter } from "@/components/app/filters";
import { RequestsTable } from "@/components/requests/requests-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES } from "@/lib/validators/requests";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listRequests } from "@/server/services/requests";
import { parseRequestFilters } from "@/server/services/requests-page";

export default async function ClientRequestsPage({
  params,
  searchParams,
}: PageProps<"/w/[org]/clients/[id]/requests">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "requests.read" });
  const list = await inOrg(actor, (s) => listRequests(s, parseRequestFilters(sp, { clientId: id })));
  const base = `/w/${actor.orgSlug}`;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar>
          <SelectFilter
            param="status"
            label="Status"
            options={REQUEST_STATUSES.map((st) => ({ value: st, label: REQUEST_STATUS_LABEL[st] }))}
          />
        </FilterBar>
        {can(actor, "requests.write") ? (
          <Button asChild variant="primary">
            <Link href={`${base}/requests/new?clientId=${id}`}>
              <Plus /> Nova solicitação
            </Link>
          </Button>
        ) : null}
      </div>
      <Card>
        <RequestsTable
          rows={list.rows}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          basePath={`${base}/clients/${id}/requests`}
          detailBase={`${base}/requests`}
          searchParams={sp}
          hideClient
        />
      </Card>
    </div>
  );
}
