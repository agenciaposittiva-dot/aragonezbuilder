"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Folder,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { STATUS_COLORS } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import {
  deleteClientCategoryAction,
  reorderClientCategoriesAction,
  saveClientCategoryAction,
  setClientCategoryAction,
} from "@/server/actions/clients";

export type ClientTreeData = {
  categories: { id: string; name: string; color: string; count: number }[];
  uncategorized: number;
  clients: { id: string; name: string; categoryId: string | null }[];
  /** Pode criar/renomear/excluir categorias e mover clientes. */
  canManage: boolean;
};

const NONE = "none";
const OPEN_KEY = "sidebar:client-tree";

/* Quais pastas estão abertas: conveniência deste navegador (nada essencial). */
function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}
let openCache: { raw: string | null; value: Record<string, boolean> } = { raw: null, value: {} };
function useOpenState(): [Record<string, boolean>, (key: string, open: boolean) => void] {
  const value = useSyncExternalStore(
    (fn) => {
      window.addEventListener("storage", fn);
      window.addEventListener(OPEN_KEY, fn);
      return () => {
        window.removeEventListener("storage", fn);
        window.removeEventListener(OPEN_KEY, fn);
      };
    },
    () => {
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(OPEN_KEY);
      } catch {
        raw = null;
      }
      if (raw !== openCache.raw) openCache = { raw, value: raw ? readOpen() : {} };
      return openCache.value;
    },
    () => openCache.value,
  );
  const set = (key: string, open: boolean) => {
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [key]: open }));
    } catch {
      // Sem armazenamento: o estado vale até recarregar.
    }
    window.dispatchEvent(new Event(OPEN_KEY));
  };
  return [value, set];
}

/**
 * Clientes organizados por categoria, dentro do menu lateral. A categoria é só
 * uma referência no cliente: mover não duplica nada (projetos, arquivos e
 * histórico continuam no cliente).
 */
export function ClientTree({
  base,
  data,
  onNavigate,
}: {
  base: string;
  data: ClientTreeData;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useOpenState();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ClientTreeData["categories"][number] | null>(null);
  const save = useOrgAction(saveClientCategoryAction);
  const reorder = useOrgAction(reorderClientCategoriesAction);
  const remove = useOrgAction(deleteClientCategoryAction, {
    success: (r) => (r.moved ? `Categoria excluída. ${r.moved} cliente(s) ficaram sem categoria.` : "Categoria excluída."),
  });
  const move = useOrgAction(setClientCategoryAction, { success: "Cliente movido." });

  const term = q.trim().toLocaleLowerCase("pt-BR");
  const groups = useMemo(() => {
    const list = [
      ...data.categories.map((c) => ({ ...c, editable: true })),
      ...(data.uncategorized ? [{ id: NONE, name: "Sem categoria", color: "zinc", count: data.uncategorized, editable: false }] : []),
    ];
    return list.map((g) => ({
      ...g,
      clients: data.clients.filter(
        (c) =>
          (c.categoryId ?? NONE) === g.id && (!term || c.name.toLocaleLowerCase("pt-BR").includes(term)),
      ),
    }));
  }, [data, term]);

  const swap = (index: number, dir: -1 | 1) => {
    const ids = data.categories.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void reorder.run({ ids });
  };

  return (
    <div className="mt-0.5 mb-1 grid gap-0.5 pl-3" data-testid="client-tree">
      <label className="relative mb-1 block">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-sidebar-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente…"
          aria-label="Buscar cliente no menu"
          className="h-7 w-full rounded-md border border-sidebar-border bg-sidebar-hover/60 pr-2 pl-7 text-[12px] text-sidebar-fg placeholder:text-sidebar-muted focus:border-accent focus:outline-none"
        />
      </label>

      {groups.map((g, gi) => {
        const isOpen = !!term || !!open[g.id];
        const color = STATUS_COLORS[g.color] ?? STATUS_COLORS.slate!;
        if (term && !g.clients.length) return null;
        return (
          <div key={g.id} data-category-id={g.id}>
            <div className="group/cat flex h-7 items-center gap-1 rounded-md pr-1 hover:bg-sidebar-hover">
              {renaming === g.id ? (
                <CategoryNameInput
                  initial={g.name}
                  onCancel={() => setRenaming(null)}
                  onSubmit={async (name) => {
                    const res = await save.run({ id: g.id, name, color: g.color as never });
                    if (res.ok) setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(g.id, !open[g.id])}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-left text-[11px] font-semibold tracking-wide text-sidebar-muted uppercase hover:text-sidebar-fg"
                >
                  <ChevronRight className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
                  <span className="relative shrink-0">
                    <Folder className="size-3.5" />
                    <span className={cn("absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full", color.dot)} />
                  </span>
                  <span className="truncate">{g.name}</span>
                  <span className="shrink-0 font-normal tabular-nums normal-case opacity-80">{g.count}</span>
                </button>
              )}
              {data.canManage && g.editable && renaming !== g.id ? (
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/cat:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <Link
                    href={`${base}/clients?novo=1&categoria=${g.id}`}
                    onClick={onNavigate}
                    aria-label={`Novo cliente em ${g.name}`}
                    title={`Novo cliente em ${g.name}`}
                    className="inline-flex size-5 items-center justify-center rounded text-sidebar-muted hover:text-sidebar-fg"
                  >
                    <Plus className="size-3.5" />
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Ações da categoria ${g.name}`}
                      className="inline-flex size-5 items-center justify-center rounded text-sidebar-muted hover:text-sidebar-fg"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      <DropdownMenuItem onSelect={() => setRenaming(g.id)}>
                        <Pencil /> Renomear
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={gi === 0} onSelect={() => swap(gi, -1)}>
                        <ArrowUp /> Mover para cima
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={gi >= data.categories.length - 1} onSelect={() => swap(gi, 1)}>
                        <ArrowDown /> Mover para baixo
                      </DropdownMenuItem>
                      <DropdownMenuLabel>Cor</DropdownMenuLabel>
                      <div className="flex flex-wrap gap-1.5 px-2 pb-2" role="radiogroup" aria-label="Cor da categoria">
                        {Object.entries(COLOR_NAME)
                          .filter(([c]) => STATUS_COLORS[c])
                          .map(([c, label]) => (
                            <button
                              key={c}
                              type="button"
                              role="radio"
                              aria-checked={g.color === c}
                              aria-label={label}
                              title={label}
                              onClick={() => void save.run({ id: g.id, name: g.name, color: c as never })}
                              className={cn(
                                "size-4 rounded-full ring-offset-1 ring-offset-surface",
                                STATUS_COLORS[c]!.dot,
                                g.color === c && "ring-2 ring-fg",
                              )}
                            />
                          ))}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-danger" onSelect={() => setDeleting(g)}>
                        <Trash2 /> Excluir categoria
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              ) : null}
            </div>
            {isOpen ? (
              <ul className="ml-4 grid gap-px border-l border-sidebar-border py-0.5 pl-1.5">
                {g.clients.length === 0 ? (
                  <li className="px-1.5 py-1 text-[11px] text-sidebar-muted">
                    {g.count ? "Clientes fora da sua equipe." : "Nenhum cliente nesta categoria."}
                  </li>
                ) : (
                  g.clients.map((c) => {
                    const href = `${base}/clients/${c.id}`;
                    const active = pathname === href || pathname.startsWith(href + "/");
                    return (
                      <li key={c.id} className="group/cl flex items-center rounded-md hover:bg-sidebar-hover">
                        <Link
                          href={href}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "min-w-0 flex-1 truncate px-1.5 py-1 text-[12px] text-sidebar-muted hover:text-sidebar-fg",
                            active && "font-medium text-sidebar-fg",
                          )}
                        >
                          {c.name}
                        </Link>
                        {data.canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={`Mover ${c.name} de categoria`}
                              title="Mover para outra categoria"
                              className="mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-sidebar-muted opacity-0 group-hover/cl:opacity-100 hover:text-sidebar-fg focus:opacity-100 [@media(hover:none)]:opacity-100"
                            >
                              <FolderInput className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-52">
                              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
                              {data.categories.map((cat) => (
                                <DropdownMenuItem
                                  key={cat.id}
                                  disabled={cat.id === c.categoryId}
                                  onSelect={() => void move.run({ clientId: c.id, categoryId: cat.id })}
                                >
                                  {cat.name}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={!c.categoryId}
                                onSelect={() => void move.run({ clientId: c.id, categoryId: null })}
                              >
                                Sem categoria
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </li>
                    );
                  })
                )}
                {g.count > g.clients.length && !term && g.clients.length ? (
                  <li>
                    <Link
                      href={`${base}/clients?category=${g.id}`}
                      onClick={onNavigate}
                      className="block px-1.5 py-1 text-[11px] text-sidebar-muted underline-offset-2 hover:text-sidebar-fg hover:underline"
                    >
                      Ver todos ({g.count})
                    </Link>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        );
      })}
      {term && groups.every((g) => !g.clients.length) ? (
        <p className="px-1.5 py-1 text-[11px] text-sidebar-muted">Nenhum cliente encontrado.</p>
      ) : null}

      {data.canManage ? (
        creating ? (
          <div className="flex h-7 items-center pr-1">
            <CategoryNameInput
              initial=""
              placeholder="Nome da categoria"
              onCancel={() => setCreating(false)}
              onSubmit={async (name) => {
                const res = await save.run({ name });
                if (res.ok) {
                  setCreating(false);
                  setOpen(res.data.id, true);
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-7 items-center gap-1.5 rounded-md px-1 text-[12px] text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
          >
            <Plus className="size-3.5" /> Nova categoria
          </button>
        )
      ) : null}

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Excluir a categoria “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting?.count
                ? `Os ${deleting.count} cliente(s) dela ficam “Sem categoria”. Nenhum cliente, projeto ou arquivo é apagado.`
                : "A categoria está vazia. Nenhum cliente é afetado."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={remove.pending}
              onClick={async () => {
                if (!deleting) return;
                const res = await remove.run({ id: deleting.id });
                if (res.ok) setDeleting(null);
              }}
            >
              Excluir categoria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const COLOR_NAME: Record<string, string> = {
  slate: "Grafite",
  zinc: "Cinza",
  blue: "Azul",
  sky: "Céu",
  amber: "Âmbar",
  orange: "Laranja",
  violet: "Violeta",
  pink: "Rosa",
  green: "Verde",
  teal: "Turquesa",
  red: "Vermelho",
};

function CategoryNameInput({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <input
      autoFocus
      value={value}
      maxLength={40}
      // readOnly (e não disabled) enquanto salva: desabilitar tiraria o foco e cancelaria a edição.
      readOnly={busy}
      placeholder={placeholder}
      aria-label={placeholder ?? "Nome da categoria"}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => !busy && onCancel()}
      onKeyDown={async (e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter") {
          e.preventDefault();
          const name = value.trim();
          if (!name || name === initial) return onCancel();
          setBusy(true);
          await onSubmit(name);
          setBusy(false);
        }
      }}
      className="h-6 w-full min-w-0 rounded border border-accent bg-sidebar-hover px-1.5 text-[12px] text-sidebar-fg placeholder:text-sidebar-muted focus:outline-none"
    />
  );
}
