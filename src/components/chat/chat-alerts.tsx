"use client";

import { AtSign, Bell, Hash, MessageSquare, Paperclip, Users, VolumeX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Avatar } from "@/components/ui/avatar";
import { DEFAULT_CHAT_ALERTS, type ChatAlertPrefs } from "@/lib/chat-alerts";
import { cn } from "@/lib/utils";
import type { InboxMessage, InboxWatch } from "@/server/services/chat";
import { chatGet } from "./api";
import { useChatDock } from "./chat-dock";
import { soundEngine, type SoundKind, type SoundState } from "./notification-sound";

/*
 * Avisos de mensagens novas em toda a área da equipe.
 *
 * Recebimento: o chat não usa WebSocket (hospedagem serverless); este
 * provedor, montado no layout da organização, consulta /api/chat/inbox com
 * intervalo adaptativo (rápido com a aba visível e a pessoa ativa, lento em
 * segundo plano, espera crescente sem conexão). O servidor só devolve
 * mensagens de conversas da própria pessoa que ela ainda pode ver; aqui cada
 * mensagem é avisada uma única vez (por id), mesmo com reconexões. Mensagens
 * antigas que chegam depois de muito tempo sem conexão não viram uma fila de
 * avisos: entram num único resumo, sem som.
 *
 * Conversa aberta: com a aba visível e a conversa na tela, a mensagem entra
 * no próprio chat — sem janela — e o som segue a preferência (sem som,
 * reduzido ou normal).
 */

type InboxResponse = {
  now: number;
  messages: InboxMessage[];
  watch: InboxWatch[];
  unread: number;
  prefs: ChatAlertPrefs;
};

type AlertCard = {
  conversationId: string;
  kind: InboxMessage["conversation"]["kind"];
  title: string;
  /** Foto atual do grupo/canal (a cada mensagem nova vem a versão mais recente). */
  image: string | null;
  author: { name: string; image: string | null };
  excerpt: string;
  attachments: number;
  count: number;
  mention: boolean;
  lastSeq: number;
  at: string;
  /** Muda a cada mensagem nova da conversa (reinicia o tempo para fechar). */
  version: number;
  soundBlocked: boolean;
};

type Summary = { messages: number; conversations: string[] };

/** Aviso de um evento da plataforma (tarefa, aprovação, solicitação…), vindo do sino. */
export type EventAlert = {
  id: string;
  title: string;
  body: string | null;
  at: string;
  image: string | null;
  /** Abre a área correspondente (e marca como lido). */
  open: () => void;
};

export type NativePermission = NotificationPermission | "unsupported";
export type SoundTest = "played" | "blocked" | "unsupported" | "device-off";

type AlertsCtx = {
  enabled: boolean;
  prefs: ChatAlertPrefs;
  /** Aplica preferências recém-salvas sem esperar a próxima consulta. */
  applyPrefs: (p: ChatAlertPrefs) => void;
  sound: SoundState;
  deviceSound: "on" | "off" | null;
  /** Ativa o som neste navegador (chamar num clique) e toca o aviso. */
  enableSound: (volume?: number) => Promise<SoundTest>;
  /** "Não tocar som neste aparelho" (a conta continua com a preferência). */
  muteDevice: () => void;
  testSound: (volume?: number) => Promise<SoundTest>;
  nativePermission: NativePermission;
  requestNative: () => Promise<NativePermission>;
  /** Avisos de eventos (do sino): cada id aparece uma única vez, sem som. */
  pushEvents: (events: EventAlert[]) => void;
};

const AlertsContext = createContext<AlertsCtx | null>(null);

export function useChatAlerts() {
  return useContext(AlertsContext);
}

const STALE_MS = 2 * 60_000;
const VISIBLE_FAST = 4000;
const VISIBLE_IDLE = 8000;
const HIDDEN = 15_000;
const IDLE_AFTER = 2 * 60_000;
const SOUND_GAP = 3000;
const SAME_CONVERSATION_GAP = 12_000;
const MAX_CARDS = 3;
const CHANNEL = "aragonez-chat-alerts";

function activeConversation(org: string): string | null {
  const m = new RegExp(`^/w/${org}/chat/([0-9a-f-]{36})`).exec(window.location.pathname);
  return m?.[1] ?? null;
}

function permission(): NativePermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function groupLabel(kind: AlertCard["kind"], name: string) {
  return kind === "channel" ? `#${name}` : name;
}

export function ChatAlertsProvider({
  org,
  enabled,
  initialPrefs,
  since,
  onUnread,
  children,
}: {
  org: string;
  enabled: boolean;
  initialPrefs: ChatAlertPrefs | null;
  /** Hora (servidor) em que a página foi aberta: nada anterior a isso vira aviso. */
  since: number;
  onUnread: (n: number) => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dock = useChatDock();
  const [prefs, setPrefs] = useState<ChatAlertPrefs>(initialPrefs ?? DEFAULT_CHAT_ALERTS);
  const [cards, setCards] = useState<AlertCard[]>([]);
  const [events, setEvents] = useState<EventAlert[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sound, setSound] = useState<SoundState>("locked");
  const [deviceSound, setDeviceSound] = useState<"on" | "off" | null>(null);
  const [nativePermission, setNativePermission] = useState<NativePermission>("unsupported");
  const [announcement, setAnnouncement] = useState("");

  // O piso vem da primeira renderização: um refresh do layout não pode pular mensagens já a caminho.
  const [floor] = useState(since);
  const prefsEpoch = useRef(0);
  const cursor = useRef<number | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const soundAt = useRef(0);
  const soundByConversation = useRef<Map<string, number>>(new Map());
  const claimed = useRef<Set<string>>(new Set());
  const seenEvents = useRef<Set<string>>(new Set());
  const channel = useRef<BroadcastChannel | null>(null);
  // Conversa na tela dentro da janela flutuante: mensagem dela não vira aviso.
  const dockActive = dock?.activeConversationId ?? null;
  const dockActiveRef = useRef(dockActive);
  useEffect(() => {
    dockActiveRef.current = dockActive;
  }, [dockActive]);
  const cardsRef = useRef<AlertCard[]>(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Estado do áudio e da permissão do sistema (só existem no navegador).
  useEffect(() => {
    const engine = soundEngine();
    const sync = () => {
      setSound(engine.state);
      setDeviceSound(engine.deviceChoice());
    };
    sync();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- só disponível no navegador
    setNativePermission(permission());
    return engine.subscribe(sync);
  }, []);

  // Com o som ligado, a próxima interação com a página libera o áudio.
  useEffect(() => {
    if (enabled && prefs.sound) soundEngine().armOnGesture();
  }, [enabled, prefs.sound]);

  // Abas da mesma pessoa combinam quem toca o som (uma vez por mensagem).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent<{ type: string; ids?: string[] }>) => {
      if (e.data?.type === "sound") for (const id of e.data.ids ?? []) claimed.current.add(id);
    };
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, []);

  const remember = (id: string) => {
    seen.current.add(id);
    if (seen.current.size > 800) {
      const keep = [...seen.current].slice(-400);
      seen.current = new Set(keep);
    }
  };

  const playOnce = useCallback((kind: SoundKind, ids: string[], volume: number) => {
    const go = () => {
      if (ids.length && ids.every((id) => claimed.current.has(id))) return;
      for (const id of ids) claimed.current.add(id);
      channel.current?.postMessage({ type: "sound", ids });
      soundEngine().play(kind, volume);
    };
    // A aba visível toca na hora; as de segundo plano esperam um pouco para não tocar junto.
    if (document.visibilityState === "visible") go();
    else setTimeout(go, 700);
  }, []);

  const openConversation = useCallback(
    (conversationId: string | null) => {
      const url = conversationId ? `/w/${org}/chat/${conversationId}` : `/w/${org}/chat`;
      setCards((cs) => (conversationId ? cs.filter((c) => c.conversationId !== conversationId) : []));
      if (!conversationId) setSummary(null);
      if (window.location.pathname.startsWith(`/w/${org}/chat`)) {
        // O chat já está aberto: troca de conversa pelo próprio histórico do chat.
        history.pushState(null, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } else if (dock) {
        // Janela flutuante: a conversa abre por cima da página atual, sem sair dela.
        dock.open(conversationId);
      } else {
        router.push(url);
      }
    },
    [org, router, dock],
  );

  const pushEvents = useCallback((items: EventAlert[]) => {
    const fresh = items.filter((e) => !seenEvents.current.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seenEvents.current.add(e.id);
    setEvents((es) => [...fresh, ...es].slice(0, 8));
    const last = fresh[0]!;
    setAnnouncement(fresh.length > 1 ? `${fresh.length} avisos novos. ${last.title}.` : `Aviso: ${last.title}.`);
  }, []);

  const showNative = useCallback(
    (groups: Map<string, InboxMessage[]>, preview: boolean, silent: boolean) => {
      if (permission() !== "granted") return;
      for (const [conversationId, msgs] of groups) {
        const last = msgs[msgs.length - 1]!;
        const direct = last.conversation.kind === "direct";
        const title = direct
          ? `Nova mensagem de ${last.author.name}`
          : `${last.author.name} em ${groupLabel(last.conversation.kind, last.conversation.name)}`;
        const body = preview
          ? `${msgs.length > 1 ? `(${msgs.length}) ` : ""}${last.excerpt || "Enviou um anexo"}`
          : msgs.length > 1
            ? `${msgs.length} mensagens novas no Chat da Equipe`
            : "Abra o Chat da Equipe para ler.";
        try {
          const n = new Notification(title, { body, tag: `chat-${conversationId}`, silent });
          n.onclick = () => {
            window.focus();
            openConversation(conversationId);
            n.close();
          };
        } catch {
          // Alguns navegadores (celular) só aceitam notificações via service worker.
        }
      }
    },
    [openConversation],
  );

  const onInbox = useEffectEvent((data: InboxResponse, epoch: number) => {
    onUnread(data.unread);
    // Preferências salvas em outro aparelho valem aqui também (sem atropelar uma alteração local recente).
    if (epoch === prefsEpoch.current && JSON.stringify(data.prefs) !== JSON.stringify(prefs)) setPrefs(data.prefs);
    const p = epoch === prefsEpoch.current ? data.prefs : prefs;

    if (data.watch.length) {
      const byId = new Map(data.watch.map((w) => [w.conversationId, w]));
      setCards((cs) => {
        const next = cs.filter((c) => {
          const w = byId.get(c.conversationId);
          return !w || (!w.gone && w.lastReadSeq < c.lastSeq);
        });
        return next.length === cs.length ? cs : next;
      });
    }

    const fresh = data.messages.filter((m) => !seen.current.has(m.id));
    if (!fresh.length) return;
    for (const m of fresh) remember(m.id);

    const visible = document.visibilityState === "visible";
    const activeId = visible ? (activeConversation(org) ?? dockActive) : null;
    const live = fresh.filter((m) => m.ageMs <= STALE_MS);
    const stale = fresh.filter((m) => m.ageMs > STALE_MS && m.conversationId !== activeId);
    const inActive = live.filter((m) => m.conversationId === activeId);
    const others = live.filter((m) => m.conversationId !== activeId);

    // Som: um por consulta, com intervalo mínimo e sem repetir para a mesma conversa em sequência.
    const engine = soundEngine();
    const wantsSound = p.sound && engine.deviceChoice() !== "off";
    let soundBlocked = false;
    if (wantsSound) {
      const kind: SoundKind | null = others.length
        ? "message"
        : inActive.length && p.activeSound !== "off"
          ? p.activeSound === "soft"
            ? "soft"
            : "message"
          : null;
      const batch = others.length ? others : inActive;
      const now = Date.now();
      const repeated = batch.every(
        (m) => now - (soundByConversation.current.get(m.conversationId) ?? 0) < SAME_CONVERSATION_GAP,
      );
      if (kind && !repeated && now - soundAt.current >= SOUND_GAP) {
        soundAt.current = now;
        for (const m of batch) soundByConversation.current.set(m.conversationId, now);
        if (engine.state === "ready")
          playOnce(
            kind,
            batch.map((m) => m.id),
            p.volume,
          );
        else soundBlocked = engine.state !== "unsupported";
      }
    }

    if (p.floating && others.length) {
      setCards((cs) => {
        const next = [...cs];
        for (const m of others) {
          const i = next.findIndex((c) => c.conversationId === m.conversationId);
          const base = {
            kind: m.conversation.kind,
            title: m.conversation.name,
            image: m.conversation.image,
            author: { name: m.author.name, image: m.author.image },
            excerpt: m.excerpt,
            attachments: m.attachments,
            at: m.createdAt,
            lastSeq: m.seq,
          };
          if (i >= 0) {
            const old = next[i]!;
            next[i] = {
              ...old,
              ...base,
              count: old.count + 1,
              mention: old.mention || m.mention,
              version: old.version + 1,
              soundBlocked: old.soundBlocked || soundBlocked,
            };
          } else {
            next.unshift({
              conversationId: m.conversationId,
              ...base,
              count: 1,
              mention: m.mention,
              version: 0,
              soundBlocked,
            });
          }
        }
        return next;
      });
    }
    if (p.floating && stale.length) {
      setSummary((s) => ({
        messages: (s?.messages ?? 0) + stale.length,
        conversations: [...new Set([...(s?.conversations ?? []), ...stale.map((m) => m.conversationId)])],
      }));
    }

    if (p.native && !visible && live.length) {
      const groups = new Map<string, InboxMessage[]>();
      for (const m of live) groups.set(m.conversationId, [...(groups.get(m.conversationId) ?? []), m]);
      // Se o som da plataforma tocou, a notificação do sistema não toca outro por cima.
      showNative(groups, p.nativePreview, wantsSound && engine.state === "ready");
    }

    if (others.length) {
      const last = others[others.length - 1]!;
      const where =
        last.conversation.kind === "direct" ? "" : ` em ${groupLabel(last.conversation.kind, last.conversation.name)}`;
      setAnnouncement(
        others.length > 1
          ? `${others.length} mensagens novas. Última de ${last.author.name}${where}.`
          : `Nova mensagem de ${last.author.name}${where}: ${last.excerpt || "anexo"}`,
      );
    }
  });

  // Consulta periódica (intervalo adaptativo, pausa sem conexão, retomada imediata ao voltar).
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let failures = 0;
    let lastActivity = Date.now();

    const delay = () => {
      if (failures) return Math.min(60_000, 4000 * 2 ** (failures - 1));
      if (document.visibilityState !== "visible") return HIDDEN;
      return Date.now() - lastActivity > IDLE_AFTER ? VISIBLE_IDLE : VISIBLE_FAST;
    };
    const schedule = (ms: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), ms);
    };
    const run = async () => {
      if (stopped || controller) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        failures = Math.max(failures, 1);
        schedule(delay());
        return;
      }
      controller = new AbortController();
      const epoch = prefsEpoch.current;
      try {
        const data = await chatGet<InboxResponse>(
          "/api/chat/inbox",
          {
            org,
            since: floor,
            after: cursor.current ?? undefined,
            watch: cardsRef.current.map((c) => c.conversationId).join(","),
          },
          controller.signal,
        );
        failures = 0;
        cursor.current = data.now;
        onInbox(data, epoch);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        failures++;
      } finally {
        controller = null;
        schedule(delay());
      }
    };

    const now = () => schedule(0);
    const onVisible = () => {
      if (document.visibilityState === "visible") now();
    };
    const onActivity = () => {
      const idle = Date.now() - lastActivity > IDLE_AFTER;
      lastActivity = Date.now();
      if (idle) now();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", now);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    schedule(800);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", now);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [enabled, org, floor]);

  // Ao voltar para a aba (ou trocar de conversa), a janela da conversa que está na tela sai.
  useEffect(() => {
    if (!enabled) return;
    const drop = () => {
      if (document.visibilityState !== "visible") return;
      const id = activeConversation(org) ?? dockActiveRef.current;
      if (id)
        setCards((cs) => (cs.some((c) => c.conversationId === id) ? cs.filter((c) => c.conversationId !== id) : cs));
    };
    document.addEventListener("visibilitychange", drop);
    window.addEventListener("popstate", drop);
    const t = setInterval(drop, 1500);
    return () => {
      document.removeEventListener("visibilitychange", drop);
      window.removeEventListener("popstate", drop);
      clearInterval(t);
    };
  }, [enabled, org]);

  const testSound = useCallback(
    async (volume?: number): Promise<SoundTest> => {
      const engine = soundEngine();
      if (engine.state === "unsupported") return "unsupported";
      if (engine.deviceChoice() === "off") return "device-off";
      const ok = engine.state === "ready" || (await engine.unlock());
      if (!ok) return (engine.state as SoundState) === "unsupported" ? "unsupported" : "blocked";
      engine.play("message", volume ?? prefs.volume);
      return "played";
    },
    [prefs.volume],
  );

  const enableSound = useCallback(
    async (volume?: number): Promise<SoundTest> => {
      const engine = soundEngine();
      engine.setDeviceChoice("on");
      const result = await testSound(volume);
      if (result === "played") setCards((cs) => cs.map((c) => (c.soundBlocked ? { ...c, soundBlocked: false } : c)));
      return result;
    },
    [testSound],
  );

  const value = useMemo<AlertsCtx>(
    () => ({
      enabled,
      prefs,
      applyPrefs: (p) => {
        prefsEpoch.current++;
        setPrefs(p);
        if (!p.floating) setCards([]);
      },
      sound,
      deviceSound,
      enableSound,
      muteDevice: () => soundEngine().setDeviceChoice("off"),
      testSound,
      nativePermission,
      requestNative: async () => {
        if (typeof Notification === "undefined") return "unsupported";
        let p: NativePermission = Notification.permission;
        if (p === "default") {
          try {
            p = await Notification.requestPermission();
          } catch {
            p = Notification.permission;
          }
        }
        setNativePermission(p);
        return p;
      },
      pushEvents,
    }),
    [enabled, prefs, sound, deviceSound, enableSound, testSound, nativePermission, pushEvents],
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
      {enabled ? (
        <AlertStack
          cards={cards}
          events={events}
          summary={summary}
          duration={prefs.duration}
          sound={sound}
          onOpen={openConversation}
          onDismiss={(id) => setCards((cs) => cs.filter((c) => c.conversationId !== id))}
          onOpenEvent={(id) => {
            const ev = events.find((e) => e.id === id);
            setEvents((es) => es.filter((e) => e.id !== id));
            ev?.open();
          }}
          onDismissEvent={(id) => setEvents((es) => es.filter((e) => e.id !== id))}
          onDismissAll={() => {
            setCards([]);
            setEvents([]);
            setSummary(null);
          }}
          onDismissSummary={() => setSummary(null)}
          onEnableSound={() => void enableSound()}
        />
      ) : null}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </AlertsContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Janelas flutuantes                                                  */
/* ------------------------------------------------------------------ */

type StackProps = {
  cards: AlertCard[];
  events: EventAlert[];
  summary: Summary | null;
  duration: number;
  sound: SoundState;
  onOpen: (conversationId: string | null) => void;
  onDismiss: (conversationId: string) => void;
  onOpenEvent: (id: string) => void;
  onDismissEvent: (id: string) => void;
  onDismissAll: () => void;
  onDismissSummary: () => void;
  onEnableSound: () => void;
};

function AlertStack(props: StackProps) {
  // Montada só com algo a mostrar: o estado de leitura (mouse/foco) recomeça a cada nova pilha.
  if (!props.cards.length && !props.events.length && !props.summary) return null;
  return <StackBody {...props} />;
}

const EDITOR_SELECTOR = "[data-editor-ready]";
const subscribeEditor = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};
const editorOpen = () => document.querySelector(EDITOR_SELECTOR) !== null;
const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
const tabHidden = () => document.visibilityState !== "visible";

function StackBody({
  cards,
  events,
  summary,
  duration,
  sound,
  onOpen,
  onDismiss,
  onOpenEvent,
  onDismissEvent,
  onDismissAll,
  onDismissSummary,
  onEnableSound,
}: StackProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hidden = useSyncExternalStore(subscribeVisibility, tabHidden, () => false);
  // Editor aberto: versão compacta no alto, ao centro (sobre a área de criação), longe da barra e dos painéis.
  const editor = useSyncExternalStore(subscribeEditor, editorOpen, () => false);

  const slots = editor ? 1 : MAX_CARDS;
  const shown = cards.slice(0, slots);
  const shownEvents = events.slice(0, Math.max(0, slots - shown.length));
  const extra = cards.length - shown.length;
  const extraEvents = events.length - shownEvents.length;
  // Lendo (mouse ou foco na pilha) ou fora da aba: nada fecha sozinho.
  const paused = hovered || focused || hidden;
  const width = editor ? "w-full" : "w-full sm:w-[22rem]";

  return (
    <section
      aria-label="Notificações de mensagens"
      className={cn(
        "pointer-events-none fixed top-[calc(env(safe-area-inset-top)+4rem)] z-[calc(var(--z-overlay)+5)] flex flex-col gap-2",
        editor
          ? "left-1/2 w-[min(20rem,calc(100vw-1rem))] -translate-x-1/2 items-stretch"
          : "right-[calc(env(safe-area-inset-right)+0.5rem)] left-[calc(env(safe-area-inset-left)+0.5rem)] items-end sm:right-[calc(env(safe-area-inset-right)+1rem)] sm:left-auto",
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      data-chat-alerts=""
    >
      {summary ? (
        <div
          role="group"
          aria-label="Mensagens recebidas enquanto você estava sem conexão"
          className={cn(
            "pointer-events-auto relative rounded-xl border border-border bg-surface shadow-lg motion-safe:animate-scale-in",
            width,
          )}
        >
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-xl p-3 pr-10 text-left hover:bg-surface-2/60"
            onClick={() => onOpen(null)}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-text">
              <MessageSquare className="size-4" />
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-medium">
                {summary.messages === 1 ? "1 mensagem nova" : `${summary.messages} mensagens novas`}
              </span>
              <span className="block text-xs text-fg-muted">
                Chegaram enquanto você estava sem conexão
                {summary.conversations.length > 1 ? `, em ${summary.conversations.length} conversas` : ""}. Abrir o
                chat.
              </span>
            </span>
          </button>
          <DismissButton label="Dispensar resumo" onClick={onDismissSummary} />
        </div>
      ) : null}
      {shown.map((c) => (
        <AlertCardView
          key={c.conversationId}
          card={c}
          duration={duration}
          paused={paused}
          sound={sound}
          compact={editor}
          onOpen={() => onOpen(c.conversationId)}
          onDismiss={() => onDismiss(c.conversationId)}
          onEnableSound={onEnableSound}
        />
      ))}
      {shownEvents.map((e) => (
        <EventCardView
          key={e.id}
          event={e}
          duration={duration}
          paused={paused}
          compact={editor}
          onOpen={() => onOpenEvent(e.id)}
          onDismiss={() => onDismissEvent(e.id)}
        />
      ))}
      {extra > 0 || extraEvents > 0 || shown.length + shownEvents.length > 1 ? (
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface/95 px-1 py-0.5 text-xs shadow-md backdrop-blur">
          {extraEvents > 0 ? (
            <span className="px-2 py-1 text-fg-muted">
              {extraEvents === 1 ? "Mais 1 aviso no sino" : `Mais ${extraEvents} avisos no sino`}
            </span>
          ) : null}
          {extra > 0 ? (
            <button
              type="button"
              className="rounded-full px-2 py-1 font-medium hover:bg-surface-2"
              onClick={() => onOpen(null)}
            >
              {extra === 1 ? "Mais 1 conversa" : `Mais ${extra} conversas`}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-full px-2 py-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            onClick={onDismissAll}
          >
            Dispensar todas
          </button>
        </div>
      ) : null}
    </section>
  );
}

function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Dispensar"
      onClick={onClick}
      className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
    >
      <X className="size-4" />
    </button>
  );
}

/** Fecha sozinho depois de `total` ms; ler (mouse/foco) ou sair da aba pausa a contagem. */
function useAutoClose(total: number, paused: boolean, version: number, onClose: () => void) {
  const remaining = useRef(total);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    remaining.current = total;
  }, [version, total]);
  useEffect(() => {
    if (!total || paused) return;
    const started = Date.now();
    const t = setTimeout(() => close(), remaining.current);
    return () => {
      clearTimeout(t);
      remaining.current = Math.max(1500, remaining.current - (Date.now() - started));
    };
  }, [paused, version, total]);
}

function EventCardView({
  event,
  duration,
  paused,
  compact,
  onOpen,
  onDismiss,
}: {
  event: EventAlert;
  duration: number;
  paused: boolean;
  compact: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  useAutoClose(duration ? duration * 1000 : 0, paused, 0, onDismiss);
  return (
    <div
      role="group"
      aria-label={`Aviso: ${event.title}`}
      data-event-alert={event.id}
      className={cn(
        "pointer-events-auto relative w-full rounded-xl border border-border bg-surface shadow-lg motion-safe:animate-scale-in",
        !compact && "sm:w-[22rem]",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 rounded-xl p-3 pr-10 text-left hover:bg-surface-2/60"
        onClick={onOpen}
        aria-label={`Abrir: ${event.title}`}
      >
        {event.image ? (
          <Avatar name={event.title} src={event.image} size={compact ? "md" : "lg"} />
        ) : (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-text",
              compact ? "size-8" : "size-10",
            )}
          >
            <Bell className="size-4" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold">{event.title}</span>
            <time dateTime={event.at} className="tabular shrink-0 text-[11px] text-fg-subtle">
              {timeLabel(event.at)}
            </time>
          </span>
          {event.body ? (
            <span
              className={cn(
                "mt-0.5 block text-sm break-words text-fg-muted",
                compact ? "line-clamp-1" : "line-clamp-2",
              )}
            >
              {event.body}
            </span>
          ) : null}
        </span>
      </button>
      <DismissButton label="Dispensar aviso" onClick={onDismiss} />
    </div>
  );
}

function AlertCardView({
  card,
  duration,
  paused,
  sound,
  compact,
  onOpen,
  onDismiss,
  onEnableSound,
}: {
  card: AlertCard;
  duration: number;
  paused: boolean;
  sound: SoundState;
  compact: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onEnableSound: () => void;
}) {
  // Menções ficam o dobro do tempo.
  useAutoClose(duration ? duration * 1000 * (card.mention ? 2 : 1) : 0, paused, card.version, onDismiss);

  const group = card.kind !== "direct";
  const KindIcon = card.kind === "channel" ? Hash : card.kind === "group" ? Users : MessageSquare;
  const blocked = card.soundBlocked && sound !== "ready";
  const label = group
    ? `Mensagem de ${card.author.name} em ${groupLabel(card.kind, card.title)}`
    : `Mensagem de ${card.author.name}`;

  return (
    <div
      role="group"
      aria-label={label}
      data-chat-alert={card.conversationId}
      className={cn(
        "pointer-events-auto relative w-full rounded-xl border border-border bg-surface shadow-lg motion-safe:animate-scale-in",
        !compact && "sm:w-[22rem]",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 rounded-xl p-3 pr-10 text-left hover:bg-surface-2/60"
        onClick={onOpen}
        aria-label={`Abrir conversa: ${label}`}
      >
        <span className="relative shrink-0">
          <Avatar name={card.author.name} src={card.author.image} size={compact ? "md" : "lg"} />
          {group ? (
            card.image ? (
              <span className="absolute -right-1.5 -bottom-1.5 inline-flex size-5 overflow-hidden rounded-md border-2 border-surface bg-surface-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.image} alt="" className="size-full object-cover" data-testid="chat-alert-group-photo" />
              </span>
            ) : (
              <span className="absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full border border-surface bg-surface-3 text-fg-muted">
                <KindIcon className="size-2.5" />
              </span>
            )
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold">{card.author.name}</span>
            <time dateTime={card.at} className="tabular shrink-0 text-[11px] text-fg-subtle">
              {timeLabel(card.at)}
            </time>
          </span>
          {group ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-fg-muted">
              {card.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.image} alt="" className="size-3.5 shrink-0 rounded-sm object-cover" />
              ) : (
                <KindIcon className="size-3 shrink-0" />
              )}
              <span className="truncate">{card.title}</span>
            </span>
          ) : null}
          <span className={cn("mt-0.5 text-sm break-words text-fg-muted", compact ? "line-clamp-1" : "line-clamp-2")}>
            {card.excerpt ? (
              card.excerpt
            ) : (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="size-3.5" /> Enviou{" "}
                {card.attachments > 1 ? `${card.attachments} anexos` : "um anexo"}
              </span>
            )}
          </span>
          {card.count > 1 || card.mention ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {card.mention ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-text">
                  <AtSign className="size-3" /> Mencionou você
                </span>
              ) : null}
              {card.count > 1 ? (
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
                  {card.count} mensagens novas
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      <DismissButton label="Dispensar notificação" onClick={onDismiss} />
      {blocked ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-fg-muted">
          <VolumeX className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {sound === "blocked"
              ? "O navegador bloqueou o som deste site. Libere o som nas permissões do site e tente de novo."
              : "O navegador só libera o som depois de um clique na página."}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 font-medium text-accent-text hover:bg-surface-2"
            onClick={onEnableSound}
          >
            Ativar som
          </button>
        </div>
      ) : null}
    </div>
  );
}
