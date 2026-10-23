"use client";

import { ChevronRight, Eye, Layers, LayoutTemplate, PencilLine } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import {
  categoryGroup,
  compareCategories,
  formatKey,
  formatLabel,
  OTHER_CATEGORY,
  TEMPLATE_CATEGORIES,
} from "@/lib/design-doc/template-categories";
import { relativeFromNow } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateDesignMetaAction } from "@/server/actions/designs";
import { DesignCardActions } from "./design-card-actions";
import { NewDesignDialog } from "./new-design-dialog";

export type GalleryTemplate = {
  id: string;
  name: string;
  width: number;
  height: number;
  thumbnail: string | null;
  pageCount: number;
  templateCategory: string | null;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  taskId: string | null;
  updatedAt: Date | string;
};

type DialogData = Pick<
  React.ComponentProps<typeof NewDesignDialog>,
  "clients" | "projects" | "templates" | "canManageTemplates"
>;

type Common = {
  base: string;
  dialog: DialogData;
  canWrite: boolean;
  canTemplates: boolean;
  canDelete: boolean;
};

const HOME_PER_ROW = 10;
const PAGE = 24;
const CHECKER = "bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface)_0_50%)] bg-[length:16px_16px]";

function groupByCategory(items: GalleryTemplate[]) {
  const map = new Map<string, GalleryTemplate[]>();
  for (const t of items) {
    const g = categoryGroup(t.templateCategory);
    map.set(g, [...(map.get(g) ?? []), t]);
  }
  return [...map.entries()].sort(([a], [b]) => compareCategories(a, b));
}

/**
 * Galeria dos modelos da agência (registros reais de `designs` com
 * `is_template`). "home": uma fileira rolável por categoria, com "Ver todos".
 * "all": todos os modelos, com filtros de categoria e formato e carregamento
 * progressivo ("Mostrar mais").
 */
export function TemplateGallery({
  items,
  variant,
  filters,
  ...common
}: Common & {
  items: GalleryTemplate[];
  variant: "home" | "all";
  filters?: { category?: string | null; format?: string | null };
}) {
  const [preview, setPreview] = useState<GalleryTemplate | null>(null);
  const [shown, setShown] = useState(PAGE);
  // Sem useMemo: o React Compiler memoriza por conta própria.
  const filtered = items.filter(
    (t) =>
      (!filters?.category || categoryGroup(t.templateCategory) === filters.category) &&
      (!filters?.format || formatKey(t.width, t.height) === filters.format),
  );
  const groups = groupByCategory(filtered);

  if (!filtered.length) {
    return variant === "home" ? null : (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={LayoutTemplate}
          title={items.length ? "Nenhum modelo com esses filtros" : "Nenhum modelo ainda"}
          description={
            items.length
              ? "Ajuste a busca, a categoria ou o formato."
              : "Modelos aceleram a produção: crie um a partir de uma arte aprovada (menu da arte → Criar modelo) ou importe um JPG/PNG."
          }
        />
      </div>
    );
  }

  const previewDialog = <TemplatePreviewDialog template={preview} onClose={() => setPreview(null)} {...common} />;

  if (variant === "home") {
    return (
      <div className="grid min-w-0 gap-6" data-testid="template-gallery">
        {groups.map(([category, list]) => (
          // min-w-0: sem isso a faixa rolável alargaria a seção (e a página inteira no celular).
          <section key={category} aria-label={category} className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-fg">
                {category} <span className="font-normal text-fg-muted">· {list.length}</span>
              </h3>
              <Link
                href={`${common.base}?tab=templates&categoria=${encodeURIComponent(category)}`}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-fg-muted hover:text-fg"
              >
                Ver todos <ChevronRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            <ul className="-mx-1 flex max-w-full snap-x scrollbar-thin gap-3 overflow-x-auto px-1 pb-2">
              {list.slice(0, HOME_PER_ROW).map((t) => (
                <li key={t.id} className="w-44 shrink-0 snap-start sm:w-52">
                  <TemplateCard t={t} onPreview={() => setPreview(t)} {...common} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {previewDialog}
      </div>
    );
  }

  // Todos os modelos: revela em lotes, mantendo a ordem das categorias.
  const visibleGroups = groups
    .reduce<{ budget: number; out: (readonly [string, GalleryTemplate[]])[] }>(
      (acc, [category, list]) => ({
        budget: acc.budget - list.length,
        out: [...acc.out, [category, list.slice(0, Math.max(0, acc.budget))] as const],
      }),
      { budget: shown, out: [] },
    )
    .out.filter(([, list]) => list.length > 0);
  const remaining = Math.max(0, filtered.length - shown);

  return (
    <div className="grid min-w-0 gap-8" data-testid="template-gallery">
      {visibleGroups.map(([category, list]) => (
        <section key={category} aria-label={category} className="min-w-0">
          <h3 className="mb-3 text-sm font-semibold text-fg">
            {category}{" "}
            <span className="font-normal text-fg-muted">· {groups.find(([c]) => c === category)?.[1].length}</span>
          </h3>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((t) => (
              <li key={t.id}>
                <TemplateCard t={t} onPreview={() => setPreview(t)} {...common} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {remaining > 0 ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
            Mostrar mais ({remaining} restantes)
          </Button>
        </div>
      ) : null}
      {previewDialog}
    </div>
  );
}

function TemplateCard({
  t,
  onPreview,
  dialog,
  canWrite,
  canTemplates,
  canDelete,
}: Common & { t: GalleryTemplate; onPreview: () => void }) {
  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow hover:shadow-md"
      data-testid="template-card"
      data-template-id={t.id}
    >
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Pré-visualizar ${t.name}`}
        className={cn(
          "relative flex aspect-[4/5] w-full items-center justify-center p-3 focus-visible:outline-none",
          CHECKER,
        )}
      >
        {t.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura salva pelo editor
          <img
            src={t.thumbnail}
            alt=""
            className="max-h-full max-w-full rounded-sm object-contain shadow-sm transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <LayoutTemplate className="size-8 text-fg-subtle" aria-hidden="true" />
        )}
        <span className="absolute top-2 left-2 flex gap-1">
          <Badge className="bg-surface/90">{formatLabel(t.width, t.height)}</Badge>
          {t.pageCount > 1 ? (
            <Badge className="bg-surface/90">
              <Layers aria-hidden="true" /> {t.pageCount}
            </Badge>
          ) : null}
        </span>
      </button>
      {canWrite || canDelete ? (
        <div className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <DesignCardActions
            id={t.id}
            name={t.name}
            isTemplate
            canManageTemplates={canTemplates}
            canDelete={canDelete}
          />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col gap-2 border-t border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={t.name}>
            {t.name}
          </p>
          <p className="truncate text-xs text-fg-muted">
            {categoryGroup(t.templateCategory)}
            {t.clientName ? ` · ${t.clientName}` : ""}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={onPreview}>
            <Eye /> Prévia
          </Button>
          {canWrite ? (
            <NewDesignDialog
              {...dialog}
              defaultTemplateId={t.id}
              title={`Nova arte com “${t.name}”`}
              description="Dê um nome e escolha o cliente. A arte nasce com as páginas e camadas do modelo."
              trigger={
                <Button variant="primary" size="xs" className="ml-auto">
                  Usar modelo
                </Button>
              }
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function TemplatePreviewDialog({
  template: t,
  onClose,
  base,
  dialog,
  canWrite,
  canTemplates,
}: Common & { template: GalleryTemplate | null; onClose: () => void }) {
  const setCategory = useOrgAction(updateDesignMetaAction, { success: "Categoria atualizada" });
  const [category, setCategoryValue] = useState<string | null>(null);
  const current = t ? (category ?? categoryGroup(t.templateCategory)) : OTHER_CATEGORY;
  return (
    <Dialog
      open={!!t}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setCategoryValue(null);
        }
      }}
    >
      <DialogContent size="xl">
        {t ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.name}</DialogTitle>
              <DialogDescription>
                {formatLabel(t.width, t.height)} · {t.width}×{t.height} px
                {t.pageCount > 1 ? ` · ${t.pageCount} páginas` : ""} · editado {relativeFromNow(t.updatedAt)}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
              <div className={cn("flex max-h-[62vh] items-center justify-center rounded-lg p-4", CHECKER)}>
                {t.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura salva pelo editor
                  <img
                    src={t.thumbnail}
                    alt={`Prévia de ${t.name}`}
                    className="max-h-[56vh] max-w-full rounded-sm object-contain shadow-md"
                  />
                ) : (
                  <p className="text-sm text-fg-muted">
                    Este modelo ainda não tem miniatura. Abra no editor para gerar.
                  </p>
                )}
              </div>
              <dl className="grid content-start gap-3 text-sm">
                <div>
                  <dt className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Categoria</dt>
                  <dd className="mt-1">
                    {canTemplates ? (
                      <NativeSelect
                        aria-label="Categoria do modelo"
                        value={
                          TEMPLATE_CATEGORIES.includes(current as (typeof TEMPLATE_CATEGORIES)[number]) ? current : ""
                        }
                        disabled={setCategory.pending}
                        onChange={(e) => {
                          const value = e.target.value || null;
                          setCategoryValue(value ?? OTHER_CATEGORY);
                          void setCategory.run({
                            id: t.id,
                            name: t.name,
                            clientId: t.clientId ?? "",
                            projectId: t.projectId ?? "",
                            taskId: t.taskId ?? "",
                            templateCategory: value,
                          });
                        }}
                      >
                        <option value="">{OTHER_CATEGORY}</option>
                        {TEMPLATE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      current
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Formato compatível</dt>
                  <dd className="mt-1">
                    {formatLabel(t.width, t.height)} — {t.width} × {t.height} px
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Páginas</dt>
                  <dd className="mt-1">{t.pageCount}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Cliente</dt>
                  <dd className="mt-1">{t.clientName ?? "Agência (todos os clientes)"}</dd>
                </div>
              </dl>
            </DialogBody>
            <DialogFooter>
              {canTemplates ? (
                <Button asChild variant="secondary">
                  <Link href={`${base}/${t.id}`}>
                    <PencilLine /> Editar o modelo
                  </Link>
                </Button>
              ) : null}
              {canWrite ? (
                <NewDesignDialog
                  {...dialog}
                  defaultTemplateId={t.id}
                  title={`Nova arte com “${t.name}”`}
                  description="Dê um nome e escolha o cliente. A arte nasce com as páginas e camadas do modelo."
                  trigger={<Button variant="primary">Usar modelo</Button>}
                />
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
