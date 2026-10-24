"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ChatAlertPrefs } from "@/lib/chat-alerts";
import { ChatAlertsProvider } from "./chat-alerts";
import { ChatDockProvider } from "./chat-dock";

/*
 * Contador de não lidas do Chat da Equipe para a navegação. Fora do chat ele
 * vem dos avisos de mensagens (ChatAlertsProvider, que também mostra as
 * janelas flutuantes, toca o som e as notificações do sistema); dentro do
 * chat, cada sincronização também o atualiza. O ChatDockProvider (janela
 * flutuante do chat) fica acima dos avisos para que um clique no aviso abra a
 * conversa na janela, sem sair da página.
 */

type Ctx = { count: number; set: (n: number) => void };
const ChatUnreadContext = createContext<Ctx | null>(null);

export function useChatUnread() {
  return useContext(ChatUnreadContext);
}

export function ChatUnreadProvider({
  org,
  enabled,
  initial,
  alerts = null,
  since,
  children,
}: {
  org: string;
  enabled: boolean;
  initial: number;
  /** Preferências de aviso da conta (null = padrão). */
  alerts?: ChatAlertPrefs | null;
  /** Hora do servidor ao montar a página: só mensagens posteriores viram aviso. */
  since: number;
  children: React.ReactNode;
}) {
  const [count, setCount] = useState(initial);
  const value = useMemo(() => ({ count, set: setCount }), [count]);
  return (
    <ChatUnreadContext.Provider value={value}>
      <ChatDockProvider org={org} enabled={enabled} unread={count}>
        <ChatAlertsProvider org={org} enabled={enabled} initialPrefs={alerts} since={since} onUnread={setCount}>
          {children}
        </ChatAlertsProvider>
      </ChatDockProvider>
    </ChatUnreadContext.Provider>
  );
}
