import { CheckCircle2, FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { SelectFilter } from "@/components/app/filters";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CHANGELOG, CHANGELOG_MODULES, CHANGELOG_STATUS } from "@/lib/changelog";
import { formatDate } from "@/lib/format";
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Atualizações" };

/** Histórico de mudanças implementadas e testadas (fonte: src/lib/changelog.ts). */
export default async function UpdatesPage({ params, searchParams }: PageProps<"/w/[org]/updates">) {
  const { org } = await params;
  const sp = await searchParams;
  await requireActor(org, { kind: "internal" });
  const selected = typeof sp.modulo === "string" && CHANGELOG_MODULES.includes(sp.modulo) ? sp.modulo : null;
  const entries = CHANGELOG.filter((e) => !selected || e.module === selected).sort((a, b) => b.n - a.n);
  return (
    <>
      <PageHeader
        title="Atualizações"
        description="O que mudou na plataforma. Só entram aqui mudanças implementadas e testadas — cada item lista os testes executados."
      >
        <div className="flex flex-wrap items-center gap-2">
          <SelectFilter
            param="modulo"
            label="Todos os módulos"
            options={CHANGELOG_MODULES.map((m) => ({ value: m, label: m }))}
          />
          <span className="text-sm text-fg-muted" data-testid="updates-count">
            {entries.length} {entries.length === 1 ? "atualização" : "atualizações"}
          </span>
        </div>
      </PageHeader>
      <ol className="grid gap-4" data-testid="updates">
        {entries.map((e) => (
          <li key={e.n}>
            <Card className="p-5" data-update={e.n}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                <span className="font-mono font-medium text-fg">#{e.n}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={e.date}>{formatDate(e.date)}</time>
                <Badge tone="accent">{e.module}</Badge>
                <Badge tone={e.status === "tested" ? "success" : "warning"}>
                  <CheckCircle2 aria-hidden="true" /> {CHANGELOG_STATUS[e.status]}
                </Badge>
              </div>
              <h2 className="mt-2 text-base font-semibold text-fg">{e.title}</h2>
              <p className="mt-1 text-sm text-fg-muted">{e.description}</p>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Problema resolvido</dt>
                  <dd className="mt-0.5">{e.fixed}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-xs font-medium tracking-wide text-fg-subtle uppercase">
                    <FlaskConical className="size-3" aria-hidden="true" /> Testes executados
                  </dt>
                  <dd className="mt-0.5">
                    <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
                      {e.tests.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                {e.notes ? (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Observações</dt>
                    <dd className="mt-0.5 text-fg-muted">{e.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
