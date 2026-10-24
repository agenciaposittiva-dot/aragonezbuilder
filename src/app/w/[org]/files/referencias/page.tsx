import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { SearchFilter, SelectFilter } from "@/components/app/filters";
import { LibraryTabs } from "@/components/files/library-tabs";
import { ReferenceFormDialog, ReferencesGrid } from "@/components/files/references-library";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { REFERENCE_KIND_LABEL, REFERENCE_KINDS, referenceListParams } from "@/lib/validators/files";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listReferences } from "@/server/services/references";

export const metadata: Metadata = { title: "Referências" };

export default async function ReferencesPage({ params, searchParams }: PageProps<"/w/[org]/files/referencias">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const canWrite = can(actor, "files.write");
  const parsed = referenceListParams.safeParse({
    q: typeof sp.q === "string" ? sp.q : undefined,
    kind: typeof sp.origem === "string" ? sp.origem : undefined,
    clientId: typeof sp.cliente === "string" ? sp.cliente : undefined,
  });
  const filters = parsed.success ? parsed.data : {};
  const data = await inOrg(actor, async (s) => ({
    rows: await listReferences(s, filters),
    clients: await clientOptions(s),
  }));
  const base = `/w/${actor.orgSlug}`;
  return (
    <>
      <PageHeader
        title="Biblioteca"
        description="Links de inspiração da equipe — vídeos, posts, pins e portfólios — organizados por cliente e etiqueta."
        actions={
          canWrite ? (
            <ReferenceFormDialog
              clients={data.clients}
              trigger={
                <Button variant="primary">
                  <Plus /> Nova referência
                </Button>
              }
            />
          ) : null
        }
      >
        <LibraryTabs base={base} />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchFilter placeholder="Buscar por título, nota ou etiqueta…" className="sm:w-80" />
        <SelectFilter
          param="origem"
          label="Todas as origens"
          options={REFERENCE_KINDS.map((k) => ({ value: k, label: REFERENCE_KIND_LABEL[k] }))}
        />
        {data.clients.length ? (
          <SelectFilter
            param="cliente"
            label="Todos os clientes"
            options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : null}
      </div>
      <ReferencesGrid
        rows={data.rows}
        clients={data.clients}
        canWrite={canWrite}
        filtered={Boolean(filters.q || filters.kind || filters.clientId)}
      />
    </>
  );
}
