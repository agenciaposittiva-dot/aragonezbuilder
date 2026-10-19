"use client";

import { Check, Library, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { installLibraryTemplateAction } from "@/server/actions/template-library";

export type LibraryItem = {
  key: string;
  name: string;
  description: string;
  category: string;
  pages: number;
  width: number;
  height: number;
  thumbnail: string | null;
  installedId: string | null;
};

/**
 * Modelos prontos para adicionar aos templates da agência (só a conta
 * administradora vê). Depois de adicionado, o modelo é um template comum.
 */
export function TemplateLibrary({ items }: { items: LibraryItem[] }) {
  const { orgSlug } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const install = useOrgAction(installLibraryTemplateAction, {
    success: "Modelo adicionado aos templates da agência",
    onSuccess: () => setBusy(null),
    onError: () => setBusy(null),
  });
  return (
    <section aria-labelledby="library-title" className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg">
          <Library className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id="library-title" className="text-sm font-semibold">
            Biblioteca de modelos
          </h2>
          <p className="text-xs text-fg-muted">
            Modelos prontos com textos, formas e fotos em camadas editáveis. Ao adicionar, as fotos de exemplo vão para
            Arquivos — troque pelas do cliente com &quot;Trocar imagem&quot;.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((t) => (
          <li
            key={t.key}
            data-testid="library-item"
            className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-2/40"
          >
            {/* Altura fixa: em coluna (celular), a proporção sozinha deixava a miniatura crescer. */}
            <div className="flex h-44 items-center justify-center bg-surface-2 p-3 sm:h-52">
              {t.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.thumbnail} alt="" className="max-h-full max-w-full rounded-sm object-contain shadow-sm" />
              ) : (
                <Library className="size-8 text-fg-subtle" />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <Badge tone="outline" className="ml-auto">
                  {t.pages > 1 ? `${t.pages} páginas` : t.category}
                </Badge>
              </div>
              <p className="line-clamp-2 text-xs text-fg-muted">{t.description}</p>
              <div className="mt-auto pt-1">
                {t.installedId ? (
                  <Button asChild variant="secondary" size="sm" className="w-full">
                    <Link href={`/w/${orgSlug}/studio/${t.installedId}`}>
                      <Check /> Nos templates · Abrir
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    loading={busy === t.key}
                    disabled={!!busy}
                    onClick={() => {
                      setBusy(t.key);
                      void install.run({ key: t.key });
                    }}
                  >
                    <Plus /> Adicionar à agência
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
