"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useChatAlerts } from "@/components/chat/chat-alerts";
import { ConversationIcon } from "@/components/chat/conversation-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markNotificationsReadAction, notificationsAction } from "@/server/actions/shell";
import { useWorkspace } from "./workspace-context";

type Item = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
  /** Avisos do chat: imagem atual da conversa. */
  chat?: { kind: string; name: string; image: string | null } | null;
};

export function NotificationsBell({ initialUnread }: { initialUnread: number }) {
  const { orgSlug } = useWorkspace();
  const router = useRouter();
  const alerts = useChatAlerts();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [, start] = useTransition();
  // Só avisos criados depois de abrir a página viram janela flutuante (os antigos ficam no sino).
  const openedAt = useRef(Date.now());

  const load = useCallback(() => {
    start(async () => {
      const res = await notificationsAction(orgSlug, {});
      if (res.ok) {
        setItems(res.data.items);
        setUnread(res.data.unread);
      }
    });
  }, [orgSlug]);

  // Atualiza o contador periodicamente enquanto a aba estiver visível.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Avisos novos (não lidos, posteriores à abertura da página) viram janela flutuante — uma vez cada.
  // Mensagens do chat não entram: já têm o próprio aviso.
  const pushFresh = useEffectEvent((list: Item[]) => {
    if (!alerts) return;
    const fresh = list.filter((n) => !n.readAt && !n.chat && new Date(n.createdAt).getTime() > openedAt.current);
    if (!fresh.length) return;
    alerts.pushEvents(
      fresh.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        at: new Date(n.createdAt).toISOString(),
        image: null,
        open: () => {
          markOne(n.id);
          if (n.link) router.push(n.link);
        },
      })),
    );
  });
  useEffect(() => {
    if (items) pushFresh(items);
  }, [items]);

  function markAll() {
    setItems((list) => list?.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })) ?? null);
    setUnread(0);
    start(async () => {
      await markNotificationsReadAction(orgSlug, { all: true });
    });
  }

  function markOne(id: string) {
    setItems((list) => list?.map((i) => (i.id === id ? { ...i, readAt: i.readAt ?? new Date() } : i)) ?? null);
    setUnread((n) => Math.max(0, n - 1));
    start(async () => {
      await markNotificationsReadAction(orgSlug, { id });
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ""}`}
          className="relative"
        >
          <Bell />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-fg">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">Notificações</p>
          {unread > 0 ? (
            <Button variant="ghost" size="xs" onClick={markAll}>
              <CheckCheck />
              Marcar todas como lidas
            </Button>
          ) : null}
        </div>
        <div className="max-h-[420px] scrollbar-thin overflow-y-auto">
          {items === null ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">Carregando…</p>
          ) : items.length === 0 ? (
            <EmptyState
              compact
              icon={Bell}
              title="Tudo em dia"
              description="Avisos sobre tarefas, aprovações e solicitações aparecem aqui."
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const content = (
                  <div className="flex gap-3 px-4 py-3">
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")}
                      aria-hidden="true"
                    />
                    {n.chat ? (
                      <ConversationIcon kind={n.chat.kind} name={n.chat.name} image={n.chat.image} className="mt-0.5" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", n.readAt ? "text-fg-muted" : "font-medium text-fg")}>{n.title}</p>
                      {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{n.body}</p> : null}
                      <p className="mt-1 text-[11px] text-fg-subtle">{formatDateTime(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className="transition-colors hover:bg-surface-2">
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => {
                          markOne(n.id);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button type="button" className="w-full text-left" onClick={() => markOne(n.id)}>
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
