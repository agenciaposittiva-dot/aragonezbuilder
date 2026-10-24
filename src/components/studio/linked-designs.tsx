import { Layers, Palette } from "lucide-react";
import Link from "next/link";
import { relativeFromNow } from "@/lib/format";

export type LinkedDesign = {
  id: string;
  name: string;
  thumbnail: string | null;
  width: number;
  height: number;
  pageCount: number;
  updatedAt: Date;
  outputFileId: string | null;
};

/**
 * Artes vinculadas a uma demanda ou projeto (mesmos registros do Estúdio, sem
 * cópia): miniatura real, páginas e acesso direto ao editor.
 */
export function LinkedDesigns({
  designs,
  base,
  empty,
}: {
  designs: LinkedDesign[];
  base: string;
  empty: string;
}) {
  if (!designs.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <Palette className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" /> {empty}
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="linked-designs">
      {designs.map((d) => (
        <li key={d.id}>
          <Link
            href={`${base}/studio/${d.id}`}
            className="group block overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong"
          >
            <span className="flex aspect-[4/5] items-center justify-center bg-surface-2">
              {d.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura em data URL salva pelo editor
                <img src={d.thumbnail} alt="" className="size-full object-contain" />
              ) : (
                <Palette className="size-6 text-fg-subtle" aria-hidden="true" />
              )}
            </span>
            <span className="block px-2 py-1.5">
              <span className="block truncate text-xs font-medium group-hover:underline">{d.name}</span>
              <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
                {d.pageCount > 1 ? (
                  <>
                    <Layers className="size-3" aria-hidden="true" /> {d.pageCount} páginas ·{" "}
                  </>
                ) : null}
                {d.outputFileId ? "exportada · " : ""}
                {relativeFromNow(d.updatedAt)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
