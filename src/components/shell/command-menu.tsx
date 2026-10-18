"use client";

import { Command } from "cmdk";
import { CornerDownLeft, FileText, FolderKanban, Inbox, ListChecks, Search, Users2 } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { searchAction } from "@/server/actions/shell";
import type { SearchHit } from "@/server/services/search";
import { getNav, type NavKey } from "./nav-registry";
import { useWorkspace } from "./workspace-context";

const TYPE_LABEL: Record<SearchHit["type"], string> = {
  client: "Clientes",
  project: "Projetos",
  task: "Tarefas",
  request: "Solicitações",
  file: "Arquivos",
};
const TYPE_ICON = { client: Users2, project: FolderKanban, task: ListChecks, request: Inbox, file: FileText };

export function CommandMenu({ nav, base }: { nav: NavKey; base: string }) {
  const groups = getNav(nav);
  const router = useRouter();
  const { orgSlug, permissions } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-menu", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-menu", onOpen);
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchAction(orgSlug, { q });
        if (id === seq.current && res.ok) setHits(res.data);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [query, orgSlug]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  const navItems = groups.flatMap((g) => g.items).filter((i) => !i.permission || permissions.includes(i.permission));
  const visibleHits = query.trim().length >= 2 ? hits : [];
  const grouped = visibleHits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.type] ??= []).push(h);
    return acc;
  }, {});

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-overlay data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed top-[12vh] left-1/2 z-[var(--z-modal)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-scale-in"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Busca global</DialogPrimitive.Title>
          <Command shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              {pending ? <Spinner className="text-fg-subtle" /> : <Search className="size-4 text-fg-subtle" />}
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Buscar clientes, projetos, tarefas, arquivos..."
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,420px)] scrollbar-thin overflow-y-auto p-2">
              {query.trim().length >= 2 && !pending && visibleHits.length === 0 ? (
                <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">
                  Nada encontrado para “{query.trim()}”.
                </Command.Empty>
              ) : null}
              {Object.entries(grouped).map(([type, items]) => (
                <Command.Group
                  key={type}
                  heading={TYPE_LABEL[type as SearchHit["type"]]}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
                >
                  {items.map((h) => {
                    const Icon = TYPE_ICON[h.type];
                    return (
                      <Command.Item
                        key={h.type + h.id}
                        value={h.type + h.id}
                        onSelect={() => go(h.href)}
                        className="flex cursor-default items-center gap-3 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-surface-2"
                      >
                        <Icon className="size-4 shrink-0 text-fg-subtle" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-fg">{h.title}</span>
                          {h.subtitle ? (
                            <span className="block truncate text-xs text-fg-muted">{h.subtitle}</span>
                          ) : null}
                        </span>
                        <CornerDownLeft className="size-3.5 text-fg-subtle opacity-0 [[data-selected=true]_&]:opacity-100" />
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
              {query.trim().length < 2 ? (
                <Command.Group
                  heading="Ir para"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
                >
                  {navItems.map((item) => (
                    <Command.Item
                      key={item.key}
                      value={item.key}
                      onSelect={() => go(base + item.path)}
                      className="flex cursor-default items-center gap-3 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-surface-2"
                    >
                      <item.icon className="size-4 text-fg-subtle" />
                      {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border bg-surface-2/50 px-4 py-2 text-xs text-fg-subtle">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navegar
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> abrir
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
