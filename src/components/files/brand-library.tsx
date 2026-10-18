"use client";

import { Check, ImageIcon, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import type { FileCategory } from "@/lib/validators/files";
import { setClientLogoAction } from "@/server/actions/files";
import type { FileListRow } from "@/server/services/files";
import { FileThumb } from "./file-thumb";
import { UploadDialog } from "./upload-dialog";

const SECTIONS: { category: FileCategory; title: string; description: string }[] = [
  {
    category: "brand_logo",
    title: "Logotipos",
    description: "Versões oficiais do logotipo (cores, negativo, símbolo).",
  },
  {
    category: "brand_asset",
    title: "Materiais de marca",
    description: "Ícones, padrões, fotos oficiais e elementos gráficos.",
  },
  { category: "brand_guideline", title: "Diretrizes", description: "Manual da marca e regras de aplicação." },
  { category: "template", title: "Templates", description: "Modelos aprovados para reaproveitar." },
];

/** Biblioteca de marca do cliente: logotipos, materiais, diretrizes, templates e artes aprovadas. */
export function BrandLibrary({
  clientId,
  files,
  approved,
  logoFileId,
  canWrite,
  canSetLogo,
  maxBytes,
}: {
  clientId: string;
  files: FileListRow[];
  approved: FileListRow[];
  logoFileId: string | null;
  canWrite: boolean;
  canSetLogo: boolean;
  maxBytes: number;
}) {
  const { orgSlug } = useWorkspace();
  const setLogo = useOrgAction(setClientLogoAction, { success: "Logotipo atualizado" });

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {SECTIONS.map((section) => {
          const list = files.filter((f) => f.category === section.category);
          return (
            <Card key={section.category}>
              <CardHeader>
                <div>
                  <CardTitle>{section.title}</CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </div>
                {canWrite ? (
                  <UploadDialog
                    target={{ clientId, category: section.category }}
                    allowCategory={false}
                    maxBytes={maxBytes}
                    trigger={
                      <Button variant="ghost" size="icon-xs" aria-label={`Enviar para ${section.title}`}>
                        <Plus />
                      </Button>
                    }
                  />
                ) : null}
              </CardHeader>
              <CardContent>
                {list.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nada enviado ainda.</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {list.map((f) => {
                      const isLogo = f.id === logoFileId;
                      const image = !!f.mimeType && /^image\/(png|jpeg|webp|gif|avif)$/.test(f.mimeType);
                      return (
                        <li key={f.id} className="grid gap-1.5">
                          <Link
                            href={`/w/${orgSlug}/files/${f.id}`}
                            className={cn(
                              "block overflow-hidden rounded-lg border bg-surface",
                              isLogo
                                ? "border-accent ring-2 ring-accent/30"
                                : "border-border hover:border-border-strong",
                            )}
                          >
                            <FileThumb
                              versionId={f.versionId}
                              mimeType={f.mimeType}
                              name={f.name}
                              hasThumbnail={f.hasThumbnail}
                              className="aspect-square w-full"
                              rounded=""
                            />
                          </Link>
                          <p className="truncate text-xs" title={f.name}>
                            {f.name}
                          </p>
                          {section.category === "brand_logo" && canSetLogo && image ? (
                            isLogo ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-text">
                                <Check className="size-3" /> Logotipo do cliente
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="text-left text-[11px] text-fg-muted hover:text-fg"
                                disabled={setLogo.pending}
                                onClick={() => setLogo.run({ clientId, fileId: f.id })}
                              >
                                Usar como logotipo
                              </button>
                            )
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Artes aprovadas</CardTitle>
            <CardDescription>Peças aprovadas ou marcadas como finais, úteis como referência de estilo.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {approved.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <ImageIcon className="size-4" /> Nenhuma arte aprovada ainda.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {approved.map((f) => (
                <li key={f.id}>
                  <Link href={`/w/${orgSlug}/files/${f.id}`} className="grid gap-1.5">
                    <FileThumb
                      versionId={f.versionId}
                      mimeType={f.mimeType}
                      name={f.name}
                      hasThumbnail={f.hasThumbnail}
                      className="aspect-square w-full border border-border"
                    />
                    <span className="truncate text-xs">{f.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
