import { Plus, Users2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientStatusBadge } from "@/components/clients/client-status";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CLIENT_STATUS, CLIENT_STATUS_LABEL } from "@/lib/validators/clients";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listClients } from "@/server/services/clients";
import { listInternalMembers } from "@/server/services/members";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientsPage({ params, searchParams }: PageProps<"/w/[org]/clients">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = pick("status");
  const { list, members } = await inOrg(actor, async (s) => ({
    list: await listClients(s, {
      q: pick("q"),
      status: CLIENT_STATUS.includes(status as never) ? (status as (typeof CLIENT_STATUS)[number]) : undefined,
      archived: pick("archived") === "1",
      page: Number(pick("page") ?? 1),
    }),
    members: await listInternalMembers(s),
  }));
  const base = `/w/${actor.orgSlug}`;
  const canWrite = can(actor, "clients.write");
  const filtered = !!(pick("q") || status || pick("archived"));

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro, equipe responsável, serviços contratados e identidade de cada marca."
        actions={
          canWrite ? (
            <ClientFormDialog
              members={members}
              trigger={
                <Button variant="primary">
                  <Plus /> Novo cliente
                </Button>
              }
            />
          ) : null
        }
      >
        <FilterBar>
          <SearchFilter placeholder="Buscar por nome ou documento" />
          <SelectFilter param="status" label="Status" options={CLIENT_STATUS.map((st) => ({ value: st, label: CLIENT_STATUS_LABEL[st] }))} />
          <SelectFilter param="archived" label="Ativos" options={[{ value: "1", label: "Arquivados" }]} />
          <ClearFilters keys={["q", "status", "archived"]} />
        </FilterBar>
      </PageHeader>

      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={Users2}
            title={filtered ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
            description={filtered ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro cliente para organizar projetos, solicitações e materiais."}
            action={
              !filtered && canWrite ? (
                <ClientFormDialog members={members} trigger={<Button variant="primary"><Plus /> Novo cliente</Button>} />
              ) : null
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Cliente</TH>
                  <TH className="hidden md:table-cell">Responsável</TH>
                  <TH>Status</TH>
                  <TH className="hidden text-right sm:table-cell">Projetos ativos</TH>
                  <TH className="hidden text-right lg:table-cell">Solicitações abertas</TH>
                </tr>
              </THead>
              <TBody>
                {list.rows.map((c) => (
                  <TR key={c.id} className="relative">
                    <TD>
                      <Link href={`${base}/clients/${c.id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                        <Avatar name={c.name} square size="md" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg">{c.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{c.industry ?? c.email ?? "—"}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="hidden md:table-cell">
                      {c.leadName ? (
                        <span className="flex items-center gap-2 text-fg-muted">
                          <Avatar name={c.leadName} src={c.leadImage} size="xs" />
                          {c.leadName}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </TD>
                    <TD>
                      <ClientStatusBadge status={c.status} />
                    </TD>
                    <TD className="hidden text-right tabular sm:table-cell">{c.activeProjects}</TD>
                    <TD className="hidden text-right tabular lg:table-cell">{c.openRequests}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} searchParams={sp} basePath={`${base}/clients`} />
          </>
        )}
      </Card>
    </>
  );
}
