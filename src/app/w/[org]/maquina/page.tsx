import { Archive, ArchiveRestore, Layers, Plus, WandSparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { MachineArchiveButton } from "@/components/machine/machine-archive-button";
import { NewMachineProjectDialog } from "@/components/machine/new-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { MACHINE_STEPS, SOURCE_KINDS, stepLabel } from "@/lib/content-machine";
import { relativeFromNow } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listMachineProjects } from "@/server/services/content-machine";

export const metadata: Metadata = { title: "Máquina de Conteúdo" };

const STATUS = {
  draft: { label: "Em criação", tone: "neutral" },
  generating: { label: "Gerando", tone: "info" },
  ready: { label: "Pronto para revisar", tone: "success" },
  archived: { label: "Arquivado", tone: "outline" },
} as const;

export default async function MachinePage({ params, searchParams }: PageProps<"/w/[org]/maquina">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "content.read" });
  const archived = sp.tab === "archived";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const clientId = typeof sp.clientId === "string" ? sp.clientId : undefined;
  const data = await inOrg(actor, async (s) => ({
    items: await listMachineProjects(s, { archived, q, clientId }),
    clients: await clientOptions(s),
  }));
  const base = `/w/${actor.orgSlug}/maquina`;
  const canWrite = can(actor, "content.write") && can(actor, "ai.use");
  const newButton = canWrite ? (
    <NewMachineProjectDialog
      clients={data.clients}
      trigger={
        <Button variant="primary">
          <Plus /> Novo conteúdo
        </Button>
      }
    />
  ) : null;

  return (
    <>
      <PageHeader
        title="Máquina de Conteúdo"
        description="Do assunto à publicação revisada: escolha a marca, descubra o tema, defina o ângulo e gere o conteúdo pronto para o editor, a prévia e o calendário."
        actions={newButton}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedNav
            param="tab"
            items={[
              { label: "Em andamento", href: base, value: "active", icon: <WandSparkles /> },
              { label: "Arquivados", href: `${base}?tab=archived`, value: "archived", icon: <Archive /> },
            ]}
          />
          <FilterBar>
            <SearchFilter placeholder="Buscar projeto" />
            <SelectFilter
              param="clientId"
              label="Cliente"
              options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FilterBar>
        </div>
      </PageHeader>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={archived ? Archive : WandSparkles}
            title={archived ? "Nada arquivado" : "Nenhum conteúdo na Máquina ainda"}
            description={
              archived
                ? "Projetos arquivados ficam aqui e podem voltar quando você quiser."
                : `São ${MACHINE_STEPS.length} etapas guiadas: ${MACHINE_STEPS.map((s) => s.label.toLowerCase()).join(", ")}. O progresso fica salvo e dá para voltar em qualquer etapa.`
            }
            action={archived ? null : newButton}
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((p) => {
            const status = STATUS[p.status];
            return (
              <li key={p.id} data-testid="machine-project" className="group relative min-w-0">
                <Link
                  href={`${base}/${p.id}`}
                  className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow hover:shadow-md"
                >
                  <div className="flex h-40 items-center justify-center bg-surface-2 p-3">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbnail}
                        alt=""
                        className="max-h-full max-w-full rounded-sm object-contain shadow-sm"
                      />
                    ) : (
                      <Layers className="size-8 text-fg-subtle" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 border-t border-border p-3">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{p.title}</p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="truncate text-xs text-fg-muted">
                      {p.clientName}
                      {p.sourceKind ? ` · ${SOURCE_KINDS[p.sourceKind]}` : ""}
                    </p>
                    {p.angle ? <p className="line-clamp-2 text-sm text-fg-muted">“{p.angle}”</p> : null}
                    <div className="mt-auto pt-1">
                      <div className="flex items-center justify-between text-xs text-fg-subtle">
                        <span>
                          Etapa {p.step} de {MACHINE_STEPS.length} · {stepLabel(p.step)}
                        </span>
                        <span>{relativeFromNow(p.updatedAt)}</span>
                      </div>
                      <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
                        role="progressbar"
                        aria-valuemin={1}
                        aria-valuemax={MACHINE_STEPS.length}
                        aria-valuenow={p.step}
                        aria-label="Progresso"
                      >
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${(p.step / MACHINE_STEPS.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
                {canWrite ? (
                  <div className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <MachineArchiveButton
                      id={p.id}
                      archived={archived}
                      icon={archived ? <ArchiveRestore /> : <Archive />}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
