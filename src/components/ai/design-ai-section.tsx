"use client";

import { ArrowLeft, ExternalLink, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DesignAiChat, type ApplyOutcome, type DesignAiHost } from "@/components/studio/design-ai-chat";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { applyDesignOperationsAction } from "@/server/actions/designs";
import type { DesignAiTarget } from "@/server/services/design-ai";

const CHECKPOINT = "Antes da edição pelo chat de IA";

/**
 * Assistente IA → editar uma arte ou carrossel existente pelo chat, sem abrir
 * o editor. As alterações são aplicadas no servidor (applyDesignOperations)
 * com controle de revisão e uma versão nomeada com o estado anterior; o
 * desfazer reaplica as operações inversas.
 */
export function DesignAiSection({ targets }: { targets: DesignAiTarget[] }) {
  const { orgSlug } = useWorkspace();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<DesignAiTarget | null>(null);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term
      ? targets.filter((t) => `${t.name} ${t.clientName ?? ""} ${t.projectName ?? ""}`.toLowerCase().includes(term))
      : targets;
  }, [q, targets]);

  const host = useMemo(() => (selected ? serverHost(orgSlug, selected) : null), [orgSlug, selected]);

  return (
    <Card className="mt-6" data-testid="design-ai-section">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent-text" /> Editar artes existentes com o chat
          </CardTitle>
          <CardDescription className="mt-0.5">
            Escolha uma arte ou carrossel e peça alterações em textos, cores ou imagens. Você revisa a proposta antes de
            aplicar e pode desfazer depois; a versão anterior fica no histórico da arte.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {selected && host ? (
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="grid content-start gap-3">
              <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setSelected(null)}>
                <ArrowLeft /> Escolher outra arte
              </Button>
              <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
                {selected.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.thumbnail} alt="" className="aspect-square w-full object-contain" />
                ) : (
                  <div className="grid aspect-square place-items-center text-xs text-fg-subtle">Sem miniatura</div>
                )}
              </div>
              <div className="grid gap-1 text-sm">
                <p className="font-medium" data-testid="design-ai-selected">
                  {selected.name}
                </p>
                <p className="text-xs text-fg-muted">
                  {[selected.clientName, selected.projectName].filter(Boolean).join(" · ") || "Sem cliente"}
                </p>
              </div>
              <Button variant="secondary" size="sm" asChild className="justify-self-start">
                <Link href={`/w/${orgSlug}/studio/${selected.id}`}>
                  <ExternalLink /> Abrir no editor
                </Link>
              </Button>
              <p className="text-[11px] text-fg-subtle">A miniatura é atualizada quando a arte é aberta no editor.</p>
            </div>
            <div className="flex h-[min(640px,75vh)] min-h-[420px] flex-col overflow-hidden rounded-lg border border-border">
              <DesignAiChat key={selected.id} host={host} />
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar arte, cliente ou projeto"
                aria-label="Buscar arte"
                className="pl-8"
              />
            </div>
            {list.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {list.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(t)}
                      className="grid w-full gap-1.5 rounded-lg border border-border p-2 text-left hover:border-accent focus-visible:border-accent focus-visible:outline-none"
                      data-testid="design-ai-target"
                    >
                      <div className="overflow-hidden rounded bg-surface-2">
                        {t.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.thumbnail} alt="" className="aspect-square w-full object-contain" />
                        ) : (
                          <div className="grid aspect-square place-items-center text-[11px] text-fg-subtle">
                            Sem miniatura
                          </div>
                        )}
                      </div>
                      <span className="truncate text-sm font-medium">{t.name}</span>
                      <span className="flex flex-wrap items-center gap-1 text-[11px] text-fg-subtle">
                        {t.pageCount > 1 ? <Badge tone="outline">{t.pageCount} páginas</Badge> : null}
                        <span className="truncate">{t.clientName ?? "Sem cliente"}</span>
                      </span>
                      <span className="text-[11px] text-fg-subtle">{formatDateTime(t.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">
                {targets.length ? "Nenhuma arte encontrada." : "Nenhuma arte criada ainda. Crie uma no Estúdio."}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Aplica no servidor, com controle de revisão; o desfazer usa a revisão da última aplicação feita aqui. */
function serverHost(orgSlug: string, selected: DesignAiTarget): DesignAiHost {
  let latest: number | null = null;
  const run = async (ops: Parameters<DesignAiHost["apply"]>[0], revision: number, checkpoint?: string) => {
    const res = await applyDesignOperationsAction(orgSlug, {
      designId: selected.id,
      revision,
      ops,
      checkpointLabel: checkpoint,
    }).catch(() => null);
    if (!res?.ok) {
      return {
        ok: false,
        error: res && !res.ok ? res.error : "Falha de conexão. Nada foi alterado.",
      } satisfies ApplyOutcome;
    }
    latest = res.data.revision;
    return { ok: true, inverse: res.data.inverse } satisfies ApplyOutcome;
  };
  return {
    designId: selected.id,
    // Fora do editor vale a versão salva no servidor (o pedido pode citar o slide: "no slide 2…").
    context: () => ({ document: null, pageId: null, selection: [] }),
    where:
      selected.pageCount > 1
        ? `Carrossel com ${selected.pageCount} páginas · cite o slide no pedido (ex.: “no slide 3…”)`
        : "Arte de uma página",
    apply: (ops, { revision }) => run(ops, revision, CHECKPOINT),
    undo: (inverse) =>
      latest === null
        ? Promise.resolve({ ok: false, error: "Nada para desfazer." } satisfies ApplyOutcome)
        : run(inverse, latest),
  };
}
