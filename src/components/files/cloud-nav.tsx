import {
  Archive,
  Building2,
  Clock,
  Cloud,
  FolderKanban,
  LayoutTemplate,
  Share2,
  Star,
  Trash2,
  Users2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CLOUD_SECTIONS, FILE_KINDS, type FileKind } from "@/lib/validators/files";

type SP = Record<string, string | string[] | undefined>;

/**
 * Pastas lógicas da Minha Nuvem. São filtros sobre os mesmos arquivos
 * (cliente, grupo de categoria, seção) — nada é duplicado ao organizar.
 */
export function CloudNav({
  basePath,
  searchParams,
  clients,
  trashHref,
}: {
  basePath: string;
  searchParams: SP;
  clients: { id: string; name: string }[];
  trashHref: string | null;
}) {
  const sp = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const view = sp("view");
  const href = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    if (view) qs.set("view", view);
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const section = sp("section");
  const clientId = sp("clientId");
  const kind = sp("kind");
  const favorites = sp("favorites") === "1";
  const none = !section && !clientId && !favorites && !sp("folderId");

  const item = (label: string, to: string, active: boolean, Icon: typeof Cloud, nested = false) => (
    <Link
      href={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg",
        nested && "pl-7 text-xs",
        active && "bg-surface-2 font-medium text-fg",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );

  return (
    <nav aria-label="Minha Nuvem" className="grid gap-0.5">
      {item("Todos os arquivos", href({}), none, Cloud)}
      {item(CLOUD_SECTIONS.recent, href({ section: "recent" }), section === "recent", Clock)}
      {item("Favoritos", href({ favorites: "1" }), favorites, Star)}
      {item(CLOUD_SECTIONS.shared, href({ section: "shared" }), section === "shared", Share2)}
      {item(CLOUD_SECTIONS.internal, href({ section: "internal" }), section === "internal", FolderKanban)}
      {item(CLOUD_SECTIONS.templates, href({ section: "templates" }), section === "templates", LayoutTemplate)}
      {item(CLOUD_SECTIONS.archived, href({ section: "archived" }), section === "archived", Archive)}
      {trashHref ? item("Lixeira", trashHref, false, Trash2) : null}
      {clients.length ? (
        <>
          <p className="mt-3 mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
            <Users2 className="size-3" /> Clientes
          </p>
          {clients.map((c) => (
            <div key={c.id}>
              {item(c.name, href({ clientId: c.id }), clientId === c.id && !kind, Building2)}
              {clientId === c.id
                ? (Object.keys(FILE_KINDS) as FileKind[]).map((k) =>
                    item(FILE_KINDS[k].label, href({ clientId: c.id, kind: k }), kind === k, FolderKanban, true),
                  )
                : null}
            </div>
          ))}
        </>
      ) : null}
    </nav>
  );
}
