"use client";

import { AlertTriangle, Copy, ExternalLink, Eye, Loader2, Palette, PenTool, Shuffle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRenderedPages } from "@/components/preview/use-rendered-pages";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { carouselVariantAction, restyleCarouselAction } from "@/server/actions/carousel-generator";
import type { StepProps } from "../machine-wizard";

/** Páginas da arte desenhadas com o mesmo motor do editor (só leitura, última versão salva). */
function DesignPages({ view }: { view: StepProps["view"] }) {
  const d = view.design;
  const designs = useMemo(
    () => (d ? [{ id: d.id, name: d.name, updatedAt: d.updatedAt, carousel: true, document: d.document }] : []),
    [d],
  );
  const rendered = useRenderedPages(designs);
  if (!d) return null;
  return (
    <div className="grid grid-cols-1 gap-2">
      <ul
        className="flex snap-x scrollbar-thin gap-3 overflow-x-auto pb-2"
        aria-label="Páginas do carrossel"
        data-testid="machine-pages"
      >
        {d.document.pages.map((p, i) => {
          const img = rendered.pages.get(`${d.id}:${p.id}`);
          return (
            <li key={p.id} className="w-40 shrink-0 snap-start sm:w-48">
              <div
                className="flex items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2"
                style={{ aspectRatio: `${p.width} / ${p.height}` }}
              >
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={`Slide ${i + 1}`} className="size-full object-contain" />
                ) : (
                  <Loader2 className="size-5 animate-spin text-fg-subtle" />
                )}
              </div>
              <p className="mt-1 text-center text-[11px] text-fg-muted">
                {/^\d/.test(p.name) ? p.name : `${String(i + 1).padStart(2, "0")} · ${p.name}`}
              </p>
            </li>
          );
        })}
      </ul>
      {rendered.error ? <p className="text-xs text-danger">{rendered.error}</p> : null}
    </div>
  );
}

function Claims({ state }: { state: StepProps["state"] }) {
  const g = state.generation;
  if (!g || (!g.claims.length && !g.warnings.length)) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {g.claims.length ? (
        <div className="rounded-lg bg-warning-soft/60 p-3 text-sm">
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" /> Dados a confirmar antes de publicar ({g.claims.length})
          </p>
          <ul className="mt-1 list-disc pl-5">
            {g.claims.map((c) => (
              <li key={c.text}>
                {c.text}
                {c.reason ? <span className="text-fg-muted"> — {c.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {g.warnings.length ? (
        <div className="rounded-lg border border-border p-3 text-xs text-fg-muted">
          <p className="font-medium text-fg">Avisos da geração</p>
          <ul className="mt-1 list-disc pl-5">
            {g.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Etapa 6: direção visual da marca aplicada; nova direção (sem custo de IA) ou segunda versão. */
export function StepVisual({ view, state, can, readOnly }: StepProps) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [busy, setBusy] = useState<"restyle" | "variant" | null>(null);
  const d = view.design;
  if (!d) return <p className="text-sm text-fg-muted">Gere o conteúdo para ver a identidade visual.</p>;
  const editable = can.designs && !readOnly && d.generated;

  const restyle = async () => {
    setBusy("restyle");
    const res = await restyleCarouselAction(orgSlug, { designId: d.id, revision: d.revision }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return toast.error(res?.error ?? "Falha de conexão.");
    toast.success(`Nova direção visual: ${res.data.direction}. Textos e imagens mantidos.`);
    router.refresh();
  };
  const variant = async () => {
    setBusy("variant");
    const res = await carouselVariantAction(orgSlug, { designId: d.id }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return toast.error(res?.error ?? "Falha de conexão.");
    toast.success("Segunda versão criada no Estúdio (a original não mudou).", {
      duration: 10_000,
      action: { label: "Abrir", onClick: () => router.push(`/w/${orgSlug}/studio/${res.data.id}`) },
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Palette className="size-4 text-accent-text" />
        <span>
          Direção visual: <strong>{d.direction ?? "personalizada"}</strong> · {d.pages} slides
        </span>
        {state.generation?.demo ? <Badge tone="info">Demonstração</Badge> : null}
      </div>
      <DesignPages view={view} />
      <p className="text-sm text-fg-muted">
        Cores, fontes e logo vêm da identidade do cliente. A composição varia por assunto, e cada slide continua com
        texto editável. Imagens geradas por IA ficam em Arquivos e podem ser trocadas no editor.
      </p>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === "restyle"} disabled={!!busy} onClick={() => void restyle()}>
            <Shuffle /> Nova direção visual
          </Button>
          <Button variant="secondary" loading={busy === "variant"} disabled={!!busy} onClick={() => void variant()}>
            <Copy /> Gerar segunda versão
          </Button>
        </div>
      ) : null}
      <Claims state={state} />
    </div>
  );
}

/** Etapa 7: revisar no editor existente. */
export function StepReview({ view }: StepProps) {
  const { orgSlug } = useWorkspace();
  const d = view.design;
  if (!d) return <p className="text-sm text-fg-muted">Gere o conteúdo para revisar no editor.</p>;
  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {[
          "Editar textos direto nos slides",
          "Trocar imagens (Arquivos ou IA) e elementos gráficos",
          "Reorganizar, duplicar ou apagar slides",
          "Regenerar só um slide ou a direção visual (Mais ações → Gerador de carrosséis)",
          "Pedir ajustes ao chat de edição por IA",
          "Voltar a versões anteriores (Histórico)",
        ].map((t) => (
          <li key={t} className="flex items-start gap-2">
            <PenTool className="mt-0.5 size-4 shrink-0 text-accent-text" /> {t}
          </li>
        ))}
      </ul>
      <div>
        <Button asChild variant="primary" size="lg">
          <Link href={`/w/${orgSlug}/studio/${d.id}`} data-testid="machine-open-editor">
            <PenTool /> Abrir no editor
          </Link>
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">
        Tudo o que for salvo no editor aparece aqui, na prévia e na peça de conteúdo, sem cópias.
      </p>
    </div>
  );
}

/** Etapa 8: prévia nas redes (feed e carrossel) com verificações de qualidade. */
export function StepPreview({ view }: StepProps) {
  const { orgSlug } = useWorkspace();
  if (!view.design || !view.content)
    return <p className="text-sm text-fg-muted">Gere o conteúdo para visualizar a publicação.</p>;
  return (
    <div className="grid grid-cols-1 gap-5">
      <DesignPages view={view} />
      <p className="text-sm text-fg-muted">
        A Central de pré-visualização mostra o carrossel como no Instagram (feed e navegação entre slides), com legenda,
        verificação de margens e proporção, e o envio para aprovação.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary" size="lg">
          <Link href={`/w/${orgSlug}/content/${view.content.id}/preview`} data-testid="machine-open-preview">
            <Eye /> Abrir pré-visualização
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/w/${orgSlug}/content/${view.content.id}`}>
            <ExternalLink /> Ver peça de conteúdo
          </Link>
        </Button>
      </div>
    </div>
  );
}
