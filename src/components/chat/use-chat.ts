"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatGet,
  chatSend,
  ChatApiError,
  newClientId,
  type ChatMessageDTO,
  type ConversationSummary,
  type ConversationView,
  type Presence,
  type SyncResponse,
  type UploadedAttachment,
} from "./api";
import { useChatUnread } from "./chat-unread";

/*
 * Motor do chat no navegador. Sem WebSocket (a hospedagem é serverless):
 * busca periódica com intervalo adaptativo — rápido com a conversa aberta e
 * a aba visível, lento em segundo plano —, retomada pelo último `rev` visto
 * (nada se perde entre uma busca e outra) e espera crescente quando a
 * conexão cai. Envios são otimistas, com `clientId` estável: reenviar depois
 * de uma falha nunca duplica a mensagem.
 */

export type PendingMessage = {
  clientId: string;
  body: string;
  replyToId: string | null;
  attachments: UploadedAttachment[];
  status: "sending" | "failed";
  error?: string;
  createdAt: string;
};

type ActiveState = {
  id: string;
  conversation: ConversationView | null;
  messages: ChatMessageDTO[];
  rev: number;
  hasMore: boolean;
  loading: boolean;
  gone: boolean;
  /** Mostrando um trecho antigo (após buscar uma mensagem); novas mensagens não entram no fim. */
  windowed: boolean;
  newWhileWindowed: number;
};

const FAST = 2500;
const IDLE = 7000;
const HIDDEN = 20000;

function mergeMessages(current: ChatMessageDTO[], incoming: ChatMessageDTO[], appendNew: boolean) {
  const byId = new Map(current.map((m) => [m.id, m]));
  let added = 0;
  for (const m of incoming) {
    const old = byId.get(m.id);
    if (old) {
      if (m.rev >= old.rev) byId.set(m.id, m);
    } else if (appendNew) {
      byId.set(m.id, m);
      added++;
    }
  }
  return { messages: [...byId.values()].sort((a, b) => a.seq - b.seq), added };
}

export function useChat(org: string, initial: { conversations: ConversationSummary[]; activeId: string | null }) {
  const [list, setList] = useState<ConversationSummary[]>(initial.conversations);
  const [active, setActive] = useState<ActiveState | null>(initial.activeId ? emptyActive(initial.activeId) : null);
  const [pending, setPending] = useState<Record<string, PendingMessage[]>>({});
  const [presence, setPresence] = useState<Presence[]>([]);
  const [connection, setConnection] = useState<"ok" | "retrying">("ok");
  const unread = useChatUnread();

  const lvRef = useRef<string>("");
  const activeRef = useRef<ActiveState | null>(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const again = useRef(false);
  const failures = useRef(0);
  const lastRead = useRef<Record<string, number>>({});

  const tickRef = useRef<() => Promise<void>>(async () => undefined);
  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void tickRef.current(), ms);
  }, []);

  const tick = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    const a = activeRef.current;
    const requested = a?.id ?? null;
    const rev = a && !a.loading && a.conversation ? a.rev : 0;
    try {
      const data = await chatGet<SyncResponse>(
        "/api/chat/sync",
        { org, lv: lvRef.current, c: requested ?? undefined, rev: requested ? rev : undefined },
        controller.signal,
      );
      failures.current = 0;
      setConnection("ok");
      lvRef.current = data.lv;
      if (data.conversations) setList(data.conversations);
      unread?.set(data.unread);
      setPresence(data.presence);
      if (requested) {
        setActive((cur) => {
          if (!cur || cur.id !== requested) return cur;
          if (data.gone) return { ...cur, gone: true, loading: false };
          if (!data.active) return cur;
          const conv = data.active.conversation;
          if (rev === 0 || !cur.conversation) {
            return {
              ...cur,
              conversation: conv,
              messages: data.active.messages,
              rev: conv.lastRev,
              hasMore: !!data.active.hasMore,
              loading: false,
              gone: false,
              windowed: false,
              newWhileWindowed: 0,
            };
          }
          const merged = mergeMessages(cur.messages, data.active.messages, !cur.windowed);
          const fresh = cur.windowed
            ? data.active.messages.filter((m) => !cur.messages.some((x) => x.id === m.id)).length
            : 0;
          return {
            ...cur,
            conversation: conv,
            messages: merged.messages,
            rev: Math.max(cur.rev, conv.lastRev),
            newWhileWindowed: cur.newWhileWindowed + fresh,
          };
        });
        // Mensagens confirmadas saem da fila local.
        const confirmed = new Set(data.active?.messages.map((m) => m.clientId) ?? []);
        if (confirmed.size) {
          setPending((p) => {
            const items = p[requested];
            if (!items?.some((x) => confirmed.has(x.clientId))) return p;
            return { ...p, [requested]: items.filter((x) => !confirmed.has(x.clientId)) };
          });
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        failures.current++;
        if (failures.current >= 2) setConnection("retrying");
        if (err instanceof ChatApiError && err.status === 401) {
          // Sessão encerrada: a próxima navegação leva ao login.
          failures.current = 6;
        }
      }
    } finally {
      inFlight.current = null;
      const hidden = typeof document !== "undefined" && document.hidden;
      const base = hidden ? HIDDEN : activeRef.current ? FAST : IDLE;
      const backoff = failures.current ? Math.min(30_000, 2000 * 2 ** (failures.current - 1)) : base;
      if (again.current) {
        again.current = false;
        schedule(50);
      } else {
        schedule(failures.current ? backoff : base);
      }
    }
  }, [org, schedule, unread]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const syncNow = useCallback(() => {
    schedule(0);
  }, [schedule]);

  useEffect(() => {
    schedule(0);
    const onVisible = () => {
      if (!document.hidden) schedule(0);
    };
    const onOnline = () => schedule(0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    };
  }, [schedule]);

  /* ---------------- conversa aberta ---------------- */

  const open = useCallback(
    (id: string | null) => {
      inFlight.current?.abort();
      inFlight.current = null;
      setActive(id ? emptyActive(id) : null);
      activeRef.current = id ? emptyActive(id) : null;
      schedule(0);
    },
    [schedule],
  );

  const loadOlder = useCallback(async () => {
    const a = activeRef.current;
    if (!a?.conversation || !a.messages.length) return;
    const first = a.messages[0]!.seq;
    const data = await chatGet<{ messages: ChatMessageDTO[]; hasMore: boolean }>("/api/chat/messages", {
      org,
      c: a.id,
      before: first,
    });
    setActive((cur) =>
      cur && cur.id === a.id
        ? {
            ...cur,
            messages: mergeMessages(cur.messages, data.messages, true).messages,
            hasMore: data.hasMore,
          }
        : cur,
    );
  }, [org]);

  /** Mostra o trecho em volta de uma mensagem antiga (resultado de busca). */
  const jumpTo = useCallback(
    async (seq: number) => {
      const a = activeRef.current;
      if (!a) return;
      if (a.messages.some((m) => m.seq === seq)) return;
      const data = await chatGet<{ messages: ChatMessageDTO[]; hasMore: boolean }>("/api/chat/messages", {
        org,
        c: a.id,
        before: seq + 26,
        limit: 50,
      });
      setActive((cur) =>
        cur && cur.id === a.id
          ? { ...cur, messages: data.messages, hasMore: data.hasMore, windowed: true, newWhileWindowed: 0 }
          : cur,
      );
    },
    [org],
  );

  const backToLatest = useCallback(() => {
    const a = activeRef.current;
    if (a) open(a.id);
  }, [open]);

  /* ---------------- envio ---------------- */

  const deliver = useCallback(
    async (conversationId: string, item: PendingMessage) => {
      try {
        const msg = await chatSend<ChatMessageDTO>("/api/chat/messages", "POST", {
          org,
          conversationId,
          clientId: item.clientId,
          body: item.body,
          replyToId: item.replyToId,
          attachmentIds: item.attachments.map((a) => a.id),
        });
        setActive((cur) =>
          cur && cur.id === conversationId && !cur.windowed
            ? { ...cur, messages: mergeMessages(cur.messages, [msg], true).messages }
            : cur,
        );
        setPending((p) => ({
          ...p,
          [conversationId]: (p[conversationId] ?? []).filter((x) => x.clientId !== item.clientId),
        }));
        lastRead.current[conversationId] = Math.max(lastRead.current[conversationId] ?? 0, msg.seq);
        syncNow();
      } catch (err) {
        const e = err instanceof ChatApiError ? err : new ChatApiError("Falha ao enviar.", 0);
        setPending((p) => ({
          ...p,
          [conversationId]: (p[conversationId] ?? []).map((x) =>
            x.clientId === item.clientId ? { ...x, status: "failed", error: e.message } : x,
          ),
        }));
      }
    },
    [org, syncNow],
  );

  const send = useCallback(
    (
      conversationId: string,
      body: string,
      opts: { replyToId?: string | null; attachments?: UploadedAttachment[] } = {},
    ) => {
      const item: PendingMessage = {
        clientId: newClientId(),
        body,
        replyToId: opts.replyToId ?? null,
        attachments: opts.attachments ?? [],
        status: "sending",
        createdAt: new Date().toISOString(),
      };
      setPending((p) => ({ ...p, [conversationId]: [...(p[conversationId] ?? []), item] }));
      void deliver(conversationId, item);
    },
    [deliver],
  );

  const retry = useCallback(
    (conversationId: string, clientId: string) => {
      const item = pending[conversationId]?.find((x) => x.clientId === clientId);
      if (!item) return;
      const next = { ...item, status: "sending" as const, error: undefined };
      setPending((p) => ({
        ...p,
        [conversationId]: (p[conversationId] ?? []).map((x) => (x.clientId === clientId ? next : x)),
      }));
      void deliver(conversationId, next);
    },
    [pending, deliver],
  );

  const discard = useCallback((conversationId: string, clientId: string) => {
    setPending((p) => ({
      ...p,
      [conversationId]: (p[conversationId] ?? []).filter((x) => x.clientId !== clientId),
    }));
  }, []);

  const replaceMessage = useCallback((msg: ChatMessageDTO) => {
    setActive((cur) => (cur ? { ...cur, messages: mergeMessages(cur.messages, [msg], false).messages } : cur));
  }, []);

  const edit = useCallback(
    async (messageId: string, body: string) => {
      const msg = await chatSend<ChatMessageDTO>(`/api/chat/messages/${messageId}`, "PATCH", { org, body });
      replaceMessage(msg);
      syncNow();
    },
    [org, replaceMessage, syncNow],
  );

  const remove = useCallback(
    async (messageId: string) => {
      await chatSend(`/api/chat/messages/${messageId}?org=${encodeURIComponent(org)}`, "DELETE");
      syncNow();
    },
    [org, syncNow],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      await chatSend("/api/chat/reactions", "POST", { org, messageId, emoji });
      syncNow();
    },
    [org, syncNow],
  );

  /** Marca como lido (só avança; evita pedidos repetidos). */
  const markRead = useCallback(
    (conversationId: string, seq: number) => {
      if ((lastRead.current[conversationId] ?? 0) >= seq) return;
      lastRead.current[conversationId] = seq;
      setList((l) => l.map((c) => (c.id === conversationId ? { ...c, unread: 0, mentions: 0 } : c)));
      void chatSend("/api/chat/read", "POST", { org, conversationId, seq })
        .then(() => syncNow())
        .catch(() => {
          lastRead.current[conversationId] = 0;
        });
    },
    [org, syncNow],
  );

  const typingSent = useRef(0);
  const typing = useCallback(
    (conversationId: string, on: boolean) => {
      const now = Date.now();
      if (on && now - typingSent.current < 3000) return;
      typingSent.current = on ? now : 0;
      void chatSend("/api/chat/typing", "POST", { org, conversationId, typing: on }).catch(() => undefined);
    },
    [org],
  );

  const activePending = useMemo(() => (active ? (pending[active.id] ?? []) : []), [active, pending]);

  return {
    list,
    setList,
    active,
    activePending,
    presence,
    connection,
    open,
    loadOlder,
    jumpTo,
    backToLatest,
    send,
    retry,
    discard,
    edit,
    remove,
    react,
    markRead,
    typing,
    syncNow,
  };
}

function emptyActive(id: string): ActiveState {
  return {
    id,
    conversation: null,
    messages: [],
    rev: 0,
    hasMore: false,
    loading: true,
    gone: false,
    windowed: false,
    newWhileWindowed: 0,
  };
}

export type ChatController = ReturnType<typeof useChat>;
