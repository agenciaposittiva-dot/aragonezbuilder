"use client";

import { ChevronUp, Maximize2, MessagesSquare, Minus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EMBED_ACTIVE, EMBED_NAVIGATE, EMBED_OPEN } from "./chat-embed-bridge";

/*
 * Janela flutuante do Chat da Equipe, disponível em toda a área da equipe
 * (inclusive no editor do Estúdio Criador). O chat de verdade roda em
 * /chat-dock/[org] dentro de um iframe do mesmo site: as mesmas conversas,
 * mensagens, anexos e permissões da página inteira. Minimizar e navegar entre
 * módulos mantêm o iframe montado — a conversa e o rascunho continuam onde
 * estavam. O estado da janela (aberta, minimizada, conversa) fica na sessão
 * desta aba; mensagens nunca ficam no navegador.
 */

type DockState = { open: boolean; minimized: boolean; conversationId: string | null };

type DockCtx = {
  state: DockState;
  unread: number;
  /** Conversa que está na tela dentro da janela (aberta e não minimizada). */
  activeConversationId: string | null;
  open: (conversationId?: string | null) => void;
  toggle: () => void;
  minimize: () => void;
  close: () => void;
};

const Ctx = createContext<DockCtx | null>(null);
const KEY = "chat-dock";
const CLOSED: DockState = { open: false, minimized: false, conversationId: null };

export function useChatDock() {
  return useContext(Ctx);
}

function readState(): DockState {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return CLOSED;
    const v = JSON.parse(raw) as Partial<DockState>;
    return {
      open: v.open === true,
      minimized: v.minimized === true,
      conversationId: typeof v.conversationId === "string" ? v.conversationId : null,
    };
  } catch {
    return CLOSED;
  }
}

function writeState(s: DockState) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Sem armazenamento: vale só até recarregar.
  }
}

export function ChatDockProvider({
  org,
  enabled,
  unread,
  children,
}: {
  org: string;
  enabled: boolean;
  unread: number;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<DockState>(CLOSED);
  const [activeInFrame, setActiveInFrame] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Conversa pedida antes de o iframe estar pronto: reenviada quando ele avisar qual conversa está na tela.
  const pending = useRef<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const onChatPage = pathname.startsWith(`/w/${org}/chat`);

  // Estado guardado na aba (recarregar a página não fecha a janela).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- só existe no navegador
    if (enabled) setState(readState());
  }, [enabled]);

  const update = useCallback((patch: Partial<DockState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      writeState(next);
      return next;
    });
  }, []);

  const post = useCallback((conversationId: string | null) => {
    frameRef.current?.contentWindow?.postMessage({ type: EMBED_OPEN, id: conversationId }, location.origin);
  }, []);

  const open = useCallback(
    (conversationId: string | null = null) => {
      update({ open: true, minimized: false, ...(conversationId ? { conversationId } : {}) });
      if (conversationId) {
        pending.current = conversationId;
        post(conversationId);
      }
    },
    [update, post],
  );

  // Mensagens do iframe: conversa na tela e navegação para outras áreas (na página de fora).
  useEffect(() => {
    if (!enabled) return;
    const onMessage = (e: MessageEvent<{ type?: string; id?: unknown; href?: unknown }>) => {
      if (e.origin !== location.origin || e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === EMBED_ACTIVE) {
        const id = typeof e.data.id === "string" ? e.data.id : null;
        if (pending.current && id !== pending.current) {
          post(pending.current);
          return;
        }
        pending.current = null;
        setActiveInFrame(id);
        update({ conversationId: id });
      } else if (e.data?.type === EMBED_NAVIGATE && typeof e.data.href === "string" && e.data.href.startsWith("/")) {
        router.push(e.data.href);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, router, update, post]);

  const value = useMemo<DockCtx>(
    () => ({
      state,
      unread,
      activeConversationId: state.open && !state.minimized && !onChatPage ? activeInFrame : null,
      open,
      toggle: () => (state.open && !state.minimized ? update({ minimized: true }) : open()),
      minimize: () => update({ minimized: true }),
      close: () => update({ open: false, minimized: false }),
    }),
    [state, unread, activeInFrame, onChatPage, open, update],
  );

  return (
    <Ctx value={value}>
      {children}
      {enabled && state.open && !onChatPage ? (
        <DockWindow
          org={org}
          state={state}
          unread={unread}
          frameRef={frameRef}
          onMinimize={() => update({ minimized: true })}
          onRestore={() => update({ minimized: false })}
          onClose={() => update({ open: false, minimized: false })}
        />
      ) : null}
    </Ctx>
  );
}

function DockWindow({
  org,
  state,
  unread,
  frameRef,
  onMinimize,
  onRestore,
  onClose,
}: {
  org: string;
  state: DockState;
  unread: number;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  // O endereço inicial do iframe não muda depois de montado (trocar de conversa é por mensagem).
  const [src] = useState(() => `/chat-dock/${org}${state.conversationId ? `/${state.conversationId}` : ""}`);
  const fullHref = `/w/${org}/chat${state.conversationId ? `/${state.conversationId}` : ""}`;
  const badge = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : null;
  return (
    <section
      role="dialog"
      aria-label="Chat da Equipe (janela flutuante)"
      data-testid="chat-dock"
      data-minimized={state.minimized ? "true" : "false"}
      className={cn(
        "fixed z-[calc(var(--z-overlay)+4)] flex flex-col overflow-hidden border border-border bg-surface shadow-2xl",
        state.minimized
          ? "right-[calc(env(safe-area-inset-right)+1rem)] bottom-[calc(env(safe-area-inset-bottom)+1rem)] w-[min(18rem,calc(100vw-2rem))] rounded-full"
          : "inset-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(40rem,calc(100dvh-5rem))] sm:w-[25rem] sm:rounded-2xl",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (state.minimized) onClose();
          else onMinimize();
        }
      }}
    >
      <header
        className={cn(
          "flex h-11 shrink-0 items-center gap-2 bg-surface px-2.5",
          !state.minimized && "border-b border-border",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm font-semibold hover:text-fg"
          onClick={state.minimized ? onRestore : undefined}
          aria-label={state.minimized ? "Restaurar o chat" : undefined}
          data-testid="chat-dock-title"
        >
          <MessagesSquare className="size-4 shrink-0 text-accent-text" aria-hidden="true" />
          <span className="truncate">Chat da Equipe</span>
          {badge ? (
            <span
              className="rounded-full bg-accent px-1.5 py-px text-[10px] font-bold text-accent-fg"
              aria-label={`${unread} não lidas`}
              data-testid="chat-dock-unread"
            >
              {badge}
            </span>
          ) : null}
        </button>
        {state.minimized ? (
          <Tooltip content="Restaurar">
            <Button variant="ghost" size="icon-sm" onClick={onRestore} aria-label="Restaurar o chat">
              <ChevronUp />
            </Button>
          </Tooltip>
        ) : (
          <>
            <Tooltip content="Abrir em tela cheia">
              <Button variant="ghost" size="icon-sm" asChild aria-label="Abrir o chat em tela cheia">
                <Link href={fullHref} onClick={onClose}>
                  <Maximize2 />
                </Link>
              </Button>
            </Tooltip>
            <Tooltip content="Minimizar">
              <Button variant="ghost" size="icon-sm" onClick={onMinimize} aria-label="Minimizar o chat">
                <Minus />
              </Button>
            </Tooltip>
          </>
        )}
        <Tooltip content="Fechar">
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar o chat">
            <X />
          </Button>
        </Tooltip>
      </header>
      {/* O iframe fica montado também minimizado: a conversa e o rascunho não se perdem. */}
      <div className={cn("min-h-0 flex-1 bg-bg", state.minimized && "hidden")}>
        <iframe
          ref={frameRef}
          src={src}
          title="Chat da Equipe"
          data-testid="chat-dock-frame"
          className="size-full border-0"
          allow="clipboard-write"
        />
      </div>
    </section>
  );
}

/** Botão do cabeçalho (e do editor) que abre a janela flutuante, com o contador de não lidas. */
export function ChatDockButton({ className }: { className?: string }) {
  const dock = useChatDock();
  const pathname = usePathname();
  if (!dock) return null;
  const { unread, state } = dock;
  const onChatPage = /^\/w\/[^/]+\/chat(\/|$)/.test(pathname);
  const pressed = state.open && !state.minimized && !onChatPage;
  return (
    <Tooltip content={onChatPage ? "Você está no Chat da Equipe" : "Chat da Equipe"}>
      <Button
        variant={pressed ? "secondary" : "ghost"}
        size="icon-sm"
        className={cn("relative", className)}
        onClick={() => (onChatPage ? undefined : dock.toggle())}
        disabled={onChatPage}
        aria-pressed={pressed}
        aria-label={`Chat da Equipe${unread ? ` (${unread} não lidas)` : ""}`}
        data-testid="chat-dock-button"
      >
        <MessagesSquare />
        {unread > 0 ? (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  );
}
