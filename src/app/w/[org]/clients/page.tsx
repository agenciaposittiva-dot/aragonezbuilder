import { PackageOpen, Plus, Users2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClientCategorySelect } from "@/components/clients/client-category-select";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientStatusBadge } from "@/components/clients/client-status";
import { ImportPackageDialog } from "@/components/clients/import-package-dialog";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { Pagination } from "@/components/app/pagination";
import { STATUS_COLORS } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CLIENT_STATUS, CLIENT_STATUS_LABEL } from "@/lib/validators/clients";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { cn } from "@/lib/utils";
import { listClientCategories } from "@/server/services/client-categories";
import { listClients } from "@/server/services/clients";
import { maxUploadBytes } from "@/server/services/files";
import { listInternalMembers } from "@/server/services/members";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientsPage({ params, searchParams }: PageProps<"/w/[org]/clients">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = pick("status");
  const category = pick("category");
  const { list, members, cats, maxBytes } = await inOrg(actor, async (s) => {
    const cats = await listClientCategories(s);
    const valid = category === "none" || cats.categories.some((c) => c.id === category);
    return {
      cats,
      maxBytes: maxUploadBytes(s),
      list: await listClients(s, {
        q: pick("q"),
        status: CLIENT_STATUS.includes(status as never) ? (status as (typeof CLIENT_STATUS)[number]) : undefined,
        category: valid ? (category as string) : undefined,
        archived: pick("archived") === "1",
        page: Number(pick("page") ?? 1),
      }),
      members: await listInternalMembers(s),
    };
  });
  const base = `/w/${actor.orgSlug}`;
  const canWrite = can(actor, "clients.write");
  const filtered = !!(pick("q") || status || pick("archived") || category);
  const categoryOpts = cats.categories.map((c) => ({ id: c.id, name: c.name }));
  const categoryName = new Map(cats.categories.map((c) => [c.id, c.name]));
  const total = cats.categories.reduce((n, c) => n + c.count, 0) + cats.uncategorized;
  // Atalho "Novo cliente" do menu lateral (com a categoria da pasta, se veio dela).
  const autoOpen = canWrite && pick("novo") === "1";
  const autoCategory = cats.categories.some((c) => c.id === pick("categoria")) ? pick("categoria") : undefined;
  const chip = (label: string, value: string | undefined, count: number, color?: string) => {
    const params = new URLSearchParams();
    for (const k of ["q", "status", "archived"]) if (pick(k)) params.set(k, pick(k)!);
    if (value) params.set("category", value);
    const active = (category ?? undefined) === value;
    return (
      <Link
        key={value ?? "all"}
        href={`${base}/clients${params.size ? `?${params}` : ""}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
          active
            ? "border-accent bg-accent-soft text-fg"
            : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
        )}
      >
        {color ? <span className={cn("size-2 rounded-full", STATUS_COLORS[color]?.dot)} aria-hidden="true" /> : null}
        {label}
        <span className="tabular-nums text-fg-subtle">{count}</span>
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro, equipe responsável, serviços contratados e identidade de cada marca."
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <ImportPackageDialog
                categories={categoryOpts}
                maxBytes={maxBytes}
                trigger={
                  <Button>
                    <PackageOpen /> Importar pacote
                  </Button>
                }
              />
              <ClientFormDialog
                members={members}
                categories={categoryOpts}
                defaultCategoryId={autoCategory}
                defaultOpen={autoOpen}
                trigger={
                  <Button variant="primary">
                    <Plus /> Novo cliente
                  </Button>
                }
              />
            </div>
          ) : null
        }
      >
        {pick("archived") === "1" ? null : (
          <nav aria-label="Categorias de clientes" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {chip("Todos", undefined, total)}
            {cats.categories.map((c) => chip(c.name, c.id, c.count, c.color))}
            {cats.uncategorized ? chip("Sem categoria", "none", cats.uncategorized, "zinc") : null}
          </nav>
        )}
        <FilterBar>
          <SearchFilter placeholder="Buscar por nome ou documento" />
          <SelectFilter
            param="status"
            label="Status"
            options={CLIENT_STATUS.map((st) => ({ value: st, label: CLIENT_STATUS_LABEL[st] }))}
          />
          <SelectFilter param="archived" label="Ativos" options={[{ value: "1", label: "Arquivados" }]} />
          <ClearFilters keys={["q", "status", "archived", "category"]} />
        </FilterBar>
      </PageHeader>

      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={Users2}
            title={filtered ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
            description={
              filtered
                ? "Ajuste a busca ou os filtros."
                : "Cadastre o primeiro cliente para organizar projetos, solicitações e materiais."
            }
            action={
              !filtered && canWrite ? (
                <ClientFormDialog
                  members={members}
                  categories={categoryOpts}
                  trigger={
                    <Button variant="primary">
                      <Plus /> Novo cliente
                    </Button>
                  }
                />
              ) : null
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Cliente</TH>
                  <TH className="hidden md:table-cell">Categoria</TH>
                  <TH className="hidden lg:table-cell">Responsável</TH>
                  <TH>Status</TH>
                  <TH className="hidden text-right sm:table-cell">Projetos ativos</TH>
                  <TH className="hidden text-right xl:table-cell">Solicitações abertas</TH>
                </tr>
              </THead>
              <TBody>
                {list.rows.map((c) => (
                  <TR key={c.id} className="relative">
                    <TD>
                      <Link
                        href={`${base}/clients/${c.id}`}
                        className="flex items-center gap-3 after:absolute after:inset-0"
                      >
                        <Avatar name={c.name} square size="md" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg">{c.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{c.industry ?? c.email ?? "—"}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="hidden md:table-cell">
                      {canWrite ? (
                        <ClientCategorySelect
                          clientId={c.id}
                          clientName={c.name}
                          value={c.categoryId}
                          categories={categoryOpts}
                        />
                      ) : (
                        <span className="text-fg-muted">
                          {c.categoryId ? (categoryName.get(c.categoryId) ?? "—") : "Sem categoria"}
                        </span>
                      )}
                    </TD>
                    <TD className="hidden lg:table-cell">
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
                    <TD className="tabular hidden text-right sm:table-cell">{c.activeProjects}</TD>
                    <TD className="tabular hidden text-right xl:table-cell">{c.openRequests}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              searchParams={sp}
              basePath={`${base}/clients`}
            />
          </>
        )}
      </Card>
    </>
  );
}
