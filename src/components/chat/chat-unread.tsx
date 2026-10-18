"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { chatGet } from "./api";

/*
 * Contador de não lidas do Chat da Equipe para a navegação (atualizado a cada
 * sincronização dentro do chat e, fora dele, a cada 30 s) e notificações do
 * navegador para diretas e menções — só com permissão da pessoa, só com a aba
 * em segundo plano e uma única vez por aviso.
 */

type Ctx = { count: number; set: (n: number) => void };
const ChatUnreadContext = createContext<Ctx | null>(null);

export function useChatUnread() {
  return useContext(ChatUnreadContext);
}

const SEEN_KEY = "chat_alerts_seen";

function seenAlerts(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function rememberAlert(id: string) {
  try {
    const all = [...seenAlerts(), id].slice(-50);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    // Sem armazenamento: no pior caso o aviso pode repetir nesta aba.
  }
}

export function ChatUnreadProvider({
  org,
  enabled,
  initial,
  children,
}: {
  org: string;
  enabled: boolean;
  initial: number;
  children: React.ReactNode;
}) {
  const [count, setCount] = useState(initial);
  const pathname = usePathname();
  const router = useRouter();
  const since = useRef(0);
  const inChat = pathname.startsWith(`/w/${org}/chat`);

  const poll = useCallback(async () => {
    try {
      const data = await chatGet<{
        unread: number;
        alerts: {
          id: string;
          title: string;
          body: string | null;
          link: string | null;
          conversationId: string | null;
        }[];
      }>("/api/chat/unread", { org, since: since.current });
      setCount(data.unread);
      since.current = Date.now() - 5000;
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        const seen = seenAlerts();
        for (const a of data.alerts) {
          if (seen.has(a.id)) continue;
          rememberAlert(a.id);
          const n = new Notification(a.title, { body: a.body ?? undefined, tag: a.conversationId ?? a.id });
          n.onclick = () => {
            window.focus();
            if (a.link) router.push(a.link);
            n.close();
          };
        }
      }
    } catch {
      // Falha temporária: tenta de novo no próximo ciclo.
    }
  }, [org, router]);

  useEffect(() => {
    // Avisos do navegador só para o que chegar depois de abrir a página.
    if (!since.current) since.current = Date.now();
    if (!enabled) return;
    // Dentro do chat a própria sincronização atualiza o contador; aqui só avisos do navegador.
    const ms = inChat ? 20_000 : 30_000;
    const id = setInterval(() => void poll(), ms);
    return () => clearInterval(id);
  }, [enabled, inChat, poll]);

  const value = useMemo(() => ({ count, set: setCount }), [count]);
  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}
