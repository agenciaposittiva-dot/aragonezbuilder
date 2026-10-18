"use client";

import {
  ArrowDown,
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Copy,
  EyeOff,
  FileText,
  ImageIcon,
  Info,
  Link2,
  ListPlus,
  LogOut,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Reply,
  RotateCcw,
  Search,
  SendHorizontal,
  SmilePlus,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useOrgAction } from "@/hooks/use-action";
import { CHAT_LIMITS, CHAT_REACTIONS, MENTION_RE } from "@/lib/chat-format";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { removeParticipantAction, setParticipantPrefsAction } from "@/server/actions/chat";
import {
  attachmentUrl,
  chatGet,
  ChatApiError,
  uploadAttachment,
  type ChatMessageDTO,
  type ConversationSummary,
  type ConversationView,
  type Presence,
  type UploadedAttachment,
} from "./api";
import { AI_ACTION_LABEL, type ChatAiAction } from "./chat-dialogs";
import { ConversationIcon } from "./conversation-icon";
import { MessageBody } from "./message-body";
import type { ChatController, PendingMessage } from "./use-chat";

type Member = { userId: string; name: string; image: string | null };

const KIND_LABEL: Record<string, string> = {
  direct: "Conversa direta",
  group: "Grupo",
  channel: "Canal",
  project: "Projeto",
  task: "Tarefa",
};

const AVAILABILITY: Record<string, string> = { available: "Disponível", busy: "Ocupado(a)", away: "Ausente" };

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Hoje";
  if (same(d, y)) return "Ontem";
  return d.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function sinceLabel(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `em ${new Date(iso).toLocaleDateString("pt-BR")}`;
}

/** Presença verdadeira: "Ativo agora" só com sinal recente; senão "visto por último" (se a pessoa permite). */
export function presenceText(p: Presence | undefined) {
  if (!p) return null;
  if (p.active) return p.availability === "available" ? "Ativo agora" : `${AVAILABILITY[p.availability]} · ativo agora`;
  if (p.lastSeenAt) return `Visto por último ${sinceLabel(p.lastSeenAt)}`;
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Upload = {
  key: string;
  name: string;
  progress: number;
  error?: string;
  done?: UploadedAttachment;
  abort: () => void;
};

export function ConversationPane({
  org,
  me,
  chat,
  summary,
  members,
  presence,
  onBack,
  onTogglePanel,
  onOpenPanel,
  onAi,
  onCreateTask,
  onLinkTask,
  onOpenTask,
  aiEnabled,
  composerText,
  setComposerText,
  focusSeq,
}: {
  org: string;
  me: { userId: string };
  chat: ChatController;
  summary: ConversationSummary | undefined;
  members: Member[];
  presence: Presence[];
  onBack: () => void;
  onTogglePanel: () => void;
  /** Abre os detalhes (foto, participantes e configurações). */
  onOpenPanel: () => void;
  onAi: (action: ChatAiAction) => void;
  onCreateTask: (m: ChatMessageDTO) => void;
  onLinkTask: (m: ChatMessageDTO) => void;
  onOpenTask: (taskId: string) => void;
  aiEnabled: boolean;
  composerText: string;
  setComposerText: (v: string) => void;
  focusSeq: number | null;
}) {
  const active = chat.active!;
  const conv = active.conversation;
  const nameMap = useMemo(() => {
    const m = new Map(members.map((x) => [x.userId, x.name]));
    for (const p of conv?.participants ?? []) m.set(p.userId, p.name);
    return m;
  }, [members, conv?.participants]);
  const nameOf = useCallback((id: string) => nameMap.get(id), [nameMap]);

  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessageDTO | null>(null);
  const [editing, setEditing] = useState<ChatMessageDTO | null>(null);
  const [firstUnreadSeq, setFirstUnreadSeq] = useState<number | null>(null);

  // Divisória "novas mensagens": calculada uma vez ao abrir a conversa (o painel é recriado por conversa).
  if (conv && firstUnreadSeq === null) {
    setFirstUnreadSeq(conv.lastSeq > conv.myLastReadSeq ? conv.myLastReadSeq + 1 : Infinity);
  }

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const lastSeq = active.messages.at(-1)?.seq ?? 0;
  const count = active.messages.length + chat.activePending.length;
  const prevCount = useRef(0);
  const prevFirst = useRef<string | null>(null);
  const prevHeight = useRef(0);

  // Mantém a posição ao carregar histórico; desce ao fim quando chegam mensagens e a pessoa já estava no fim.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = active.messages[0]?.id ?? null;
    if (prevFirst.current && first !== prevFirst.current && count > prevCount.current && !active.windowed) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop;
    } else if (count > prevCount.current && (atBottom || prevCount.current === 0) && !active.windowed) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = first;
    prevCount.current = count;
    prevHeight.current = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, active.messages]);

  // Lido: com a conversa visível e no fim.
  useEffect(() => {
    if (!conv || !atBottom || active.windowed || !lastSeq) return;
    if (typeof document !== "undefined" && document.hidden) return;
    chat.markRead(conv.id, lastSeq);
  }, [conv, atBottom, lastSeq, active.windowed, chat]);

  // Pular para uma mensagem (link copiado ou busca).
  useEffect(() => {
    if (!focusSeq || !conv) return;
    void chat.jumpTo(focusSeq).then(() => {
      setTimeout(() => {
        const node = scroller.current?.querySelector(`[data-seq="${focusSeq}"]`);
        if (node) {
          node.scrollIntoView({ block: "center" });
          setHighlight(node.getAttribute("data-id"));
        }
      }, 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq, conv?.id]);

  // Histórico progressivo ao chegar no topo.
  const topSentinel = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => {
    const node = topSentinel.current;
    if (!node || !active.hasMore) return;
    const obs = new IntersectionObserver(async (entries) => {
      if (!entries[0]?.isIntersecting || loadingOlder) return;
      setLoadingOlder(true);
      await chat.loadOlder().catch(() => toast.error("Não foi possível carregar mensagens anteriores."));
      setLoadingOlder(false);
    });
    obs.observe(node);
    return () => obs.disconnect();
  }, [active.hasMore, chat, loadingOlder]);

  const prefs = useOrgAction(setParticipantPrefsAction, { onSuccess: () => chat.syncNow() });
  const leave = useOrgAction(removeParticipantAction, {
    success: "Você saiu da conversa",
    onSuccess: () => {
      chat.syncNow();
      onBack();
    },
  });

  if (active.gone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium">Conversa não encontrada</p>
        <p className="max-w-sm text-sm text-fg-muted">Ela pode ter sido removida, ou você não tem mais acesso a ela.</p>
        <Button onClick={onBack}>Voltar às conversas</Button>
      </div>
    );
  }
  if (!conv) {
    return (
      <div className="flex flex-1 items-center justify-center" aria-busy="true">
        <Spinner />
      </div>
    );
  }

  const other = conv.kind === "direct" ? conv.participants.find((p) => p.userId !== me.userId) : undefined;
  const otherPresence = other ? presence.find((p) => p.userId === other.userId) : undefined;
  const typingNames = conv.participants.filter((p) => p.typing).map((p) => p.name.split(" ")[0]);
  const subtitle =
    conv.kind === "direct"
      ? (presenceText(otherPresence) ?? KIND_LABEL.direct)
      : [
          KIND_LABEL[conv.kind],
          conv.isPrivate ? "privado" : null,
          `${conv.participants.length} participantes`,
          conv.topic,
        ]
          .filter(Boolean)
          .join(" · ");

  const items: React.ReactNode[] = [];
  let prev: ChatMessageDTO | null = null;
  for (const m of active.messages) {
    if (!prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) {
      items.push(
        <div key={`d-${m.id}`} className="sticky top-0 z-[1] flex justify-center py-2" role="separator">
          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-fg-muted shadow-xs">
            {dayLabel(m.createdAt)}
          </span>
        </div>,
      );
    }
    if (firstUnreadSeq !== null && m.seq === firstUnreadSeq && m.authorId !== me.userId) {
      items.push(
        <div key={`u-${m.id}`} className="my-2 flex items-center gap-2 text-[11px] font-medium text-accent-text">
          <span className="h-px flex-1 bg-accent/40" /> Novas mensagens <span className="h-px flex-1 bg-accent/40" />
        </div>,
      );
    }
    const grouped =
      !!prev &&
      prev.kind === "text" &&
      m.kind === "text" &&
      prev.authorId === m.authorId &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000 &&
      new Date(prev.createdAt).toDateString() === new Date(m.createdAt).toDateString();
    items.push(
      <MessageItem
        key={m.id}
        org={org}
        m={m}
        me={me.userId}
        conv={conv}
        grouped={grouped}
        nameOf={nameOf}
        highlighted={highlight === m.id}
        chat={chat}
        onReply={() => setReplyTo(m)}
        onEdit={() => startEdit(m)}
        onCreateTask={() => onCreateTask(m)}
        onLinkTask={() => onLinkTask(m)}
        onOpenTask={onOpenTask}
      />,
    );
    prev = m;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Cabeçalho */}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onBack} aria-label="Voltar às conversas">
          <ArrowLeft />
        </Button>
        <button
          type="button"
          onClick={onOpenPanel}
          title="Ver detalhes da conversa"
          data-testid="chat-header-details"
          className="-my-1 flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-2 text-left transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <ConversationIcon kind={conv.kind} name={conv.name} image={conv.image} />
          <span className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">
              {conv.kind === "channel" ? "#" : ""}
              {conv.name}
            </h2>
            <span className="block truncate text-xs text-fg-muted">{subtitle}</span>
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setSearchOpen((v) => !v)}
          aria-label="Buscar nesta conversa"
          aria-pressed={searchOpen}
        >
          <Search />
        </Button>
        {aiEnabled ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Inteligência artificial">
                <Sparkles />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>IA no chat</DropdownMenuLabel>
              {(["catch_up", "summary", "decisions", "tasks", "ask"] as const).map((a) => (
                <DropdownMenuItem key={a} onSelect={() => onAi(a)}>
                  {AI_ACTION_LABEL[a]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="icon-sm" onClick={onTogglePanel} aria-label="Detalhes da conversa">
          <Info />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Mais opções da conversa">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => prefs.run({ conversationId: conv.id, pinned: !summary?.pinned })}>
              <Pin /> {summary?.pinned ? "Desafixar" : "Fixar no topo"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => prefs.run({ conversationId: conv.id, favorite: !summary?.favorite })}>
              <Star /> {summary?.favorite ? "Remover dos favoritos" : "Favoritar"}
            </DropdownMenuItem>
            {conv.kind === "group" || conv.kind === "channel" ? (
              <DropdownMenuItem onSelect={onOpenPanel}>
                <ImageIcon /> {conv.canEditPhoto ? "Foto e detalhes" : "Detalhes"}{" "}
                {conv.kind === "channel" ? "do canal" : "do grupo"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {summary?.muted ? (
              <DropdownMenuItem onSelect={() => prefs.run({ conversationId: conv.id, muteHours: 0 })}>
                <Bell /> Reativar avisos
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => prefs.run({ conversationId: conv.id, muteHours: 8 })}>
                  <BellOff /> Silenciar por 8 horas
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => prefs.run({ conversationId: conv.id, muteHours: -1 })}>
                  <BellOff /> Silenciar até eu reativar
                </DropdownMenuItem>
              </>
            )}
            {conv.kind !== "direct" ? (
              <>
                <DropdownMenuLabel>Avisos desta conversa</DropdownMenuLabel>
                {(
                  [
                    ["all", "Todas as mensagens"],
                    ["mentions", "Só menções"],
                    ["none", "Nenhum"],
                  ] as const
                ).map(([v, label]) => (
                  <DropdownMenuItem key={v} onSelect={() => prefs.run({ conversationId: conv.id, notify: v })}>
                    {summary?.notify === v ? <Check /> : <span className="size-4" />} {label}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => (prefs.run({ conversationId: conv.id, hidden: true }), onBack())}>
              <EyeOff /> Arquivar para mim
            </DropdownMenuItem>
            {conv.kind !== "direct" && conv.joined ? (
              <DropdownMenuItem
                variant="danger"
                onSelect={() => leave.run({ conversationId: conv.id, userId: me.userId })}
              >
                <LogOut /> Sair da conversa
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {searchOpen ? (
        <ConversationSearch
          org={org}
          conversationId={conv.id}
          onPick={(seq) => {
            void chat.jumpTo(seq).then(() =>
              setTimeout(() => {
                const node = scroller.current?.querySelector(`[data-seq="${seq}"]`);
                node?.scrollIntoView({ block: "center" });
                setHighlight(node?.getAttribute("data-id") ?? null);
              }, 50),
            );
          }}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {chat.connection === "retrying" ? (
        <p role="status" className="bg-warning/15 px-4 py-1.5 text-xs text-fg">
          Reconectando… as mensagens enviadas ficam na fila e seguem quando a conexão voltar.
        </p>
      ) : null}

      {/* Mensagens */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-4"
        aria-live="polite"
        aria-relevant="additions"
        onDragOver={(e) => e.preventDefault()}
      >
        <div ref={topSentinel} />
        {active.hasMore ? (
          <div className="flex justify-center py-2">
            <Button
              size="xs"
              variant="ghost"
              loading={loadingOlder}
              onClick={async () => {
                setLoadingOlder(true);
                await chat.loadOlder().catch(() => toast.error("Não foi possível carregar mensagens anteriores."));
                setLoadingOlder(false);
              }}
            >
              Carregar mensagens anteriores
            </Button>
          </div>
        ) : active.messages.length ? (
          <p className="py-3 text-center text-xs text-fg-subtle">Início da conversa</p>
        ) : null}
        {active.messages.length || chat.activePending.length ? (
          items
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <p className="text-sm font-medium">Nenhuma mensagem ainda</p>
            <p className="text-xs text-fg-muted">Escreva a primeira mensagem abaixo.</p>
          </div>
        )}
        {chat.activePending.map((p) => (
          <PendingItem
            key={p.clientId}
            p={p}
            nameOf={nameOf}
            me={me.userId}
            onRetry={() => chat.retry(conv.id, p.clientId)}
            onDiscard={() => chat.discard(conv.id, p.clientId)}
          />
        ))}
        {typingNames.length ? (
          <p className="px-1 py-1 text-xs text-fg-muted" aria-live="polite">
            {typingNames.join(", ")} {typingNames.length === 1 ? "está digitando…" : "estão digitando…"}
          </p>
        ) : null}
      </div>

      {active.windowed || (!atBottom && active.messages.length > 0) ? (
        <div className="pointer-events-none relative">
          <Button
            size="xs"
            variant="secondary"
            className="pointer-events-auto absolute right-4 bottom-2 shadow-md"
            onClick={() => {
              if (active.windowed) chat.backToLatest();
              else scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            }}
          >
            <ArrowDown />
            {active.windowed && active.newWhileWindowed ? `${active.newWhileWindowed} novas` : "Ir para o fim"}
          </Button>
        </div>
      ) : null}

      <Composer
        org={org}
        conv={conv}
        members={members}
        nameOf={nameOf}
        chat={chat}
        aiEnabled={aiEnabled}
        onAi={onAi}
        text={composerText}
        setText={setComposerText}
        replyTo={replyTo}
        setReplyTo={setReplyTo}
        editing={editing}
        setEditing={setEditing}
      />
    </div>
  );

  // Hoisted pelos handlers acima (declarações de função dentro do componente).
  function startEdit(m: ChatMessageDTO) {
    setEditing(m);
    setComposerText(m.body.replace(MENTION_RE, (_, id: string) => `@${nameOf(id) ?? "alguém"}`));
  }
}

/* ------------------------------------------------------------------ */

export { ConversationIcon } from "./conversation-icon";

function MessageItem({
  org,
  m,
  me,
  conv,
  grouped,
  nameOf,
  highlighted,
  chat,
  onReply,
  onEdit,
  onCreateTask,
  onLinkTask,
  onOpenTask,
}: {
  org: string;
  m: ChatMessageDTO;
  me: string;
  conv: ConversationView;
  grouped: boolean;
  nameOf: (id: string) => string | undefined;
  highlighted: boolean;
  chat: ChatController;
  onReply: () => void;
  onEdit: () => void;
  onCreateTask: () => void;
  onLinkTask: () => void;
  onOpenTask: (id: string) => void;
}) {
  if (m.kind === "system") {
    return (
      <div data-seq={m.seq} data-id={m.id} className="my-1.5 flex justify-center px-6 text-center">
        <MessageBody body={m.body} nameOf={nameOf} me={me} className="text-xs text-fg-muted" />
      </div>
    );
  }
  const mine = m.authorId === me;
  const deleted = !!m.deletedAt;
  const readByOther =
    conv.kind === "direct" && conv.participants.some((p) => p.userId !== me && p.lastReadSeq >= m.seq);
  const canDelete = mine || conv.moderator;

  const copyText = async () => {
    await navigator.clipboard.writeText(m.body.replace(MENTION_RE, (_, id: string) => `@${nameOf(id) ?? "alguém"}`));
    toast.success("Texto copiado");
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${location.origin}/w/${org}/chat/${conv.id}?m=${m.seq}`);
    toast.success("Link da mensagem copiado (só quem participa consegue abrir)");
  };

  return (
    <div
      data-seq={m.seq}
      data-id={m.id}
      // Focável: no celular (sem passar o mouse) um toque mostra as ações da mensagem.
      tabIndex={0}
      data-testid="chat-message"
      className={cn(
        "group relative flex gap-2.5 rounded-md px-1.5 transition-colors outline-none hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-accent/50",
        grouped ? "py-0.5" : "mt-2 pt-1.5 pb-0.5",
        highlighted && "bg-accent/15",
      )}
    >
      <div className="w-8 shrink-0">
        {grouped ? null : <Avatar name={m.authorName ?? "?"} src={m.authorImage} size="md" />}
      </div>
      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{m.authorName ?? "Pessoa removida"}</span>
            <time
              className="text-[11px] text-fg-subtle"
              dateTime={m.createdAt}
              title={new Date(m.createdAt).toLocaleString("pt-BR")}
            >
              {timeLabel(m.createdAt)}
            </time>
          </p>
        )}
        {m.replyTo ? (
          <div className="mb-1 border-l-2 border-border-strong pl-2 text-xs text-fg-muted">
            <span className="font-medium">{m.replyTo.authorName ?? "Alguém"}</span>:{" "}
            {m.replyTo.deleted ? (
              <em>mensagem apagada</em>
            ) : (
              <span className="line-clamp-2">
                {m.replyTo.body.replace(MENTION_RE, (_, id: string) => `@${nameOf(id) ?? "alguém"}`)}
              </span>
            )}
          </div>
        ) : null}
        {deleted ? (
          <p className="text-sm text-fg-subtle italic">Mensagem apagada</p>
        ) : (
          <>
            {m.body ? <MessageBody body={m.body} nameOf={nameOf} me={me} /> : null}
            {m.attachments.length ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {m.attachments.map((a) =>
                  a.mimeType.startsWith("image/") && a.mimeType !== "image/svg+xml" ? (
                    <a key={a.id} href={attachmentUrl(org, a.id)} target="_blank" rel="noopener" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachmentUrl(org, a.id)}
                        alt={a.name}
                        loading="lazy"
                        className="max-h-56 max-w-full rounded-md border border-border object-contain sm:max-w-xs"
                        style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}
                      />
                    </a>
                  ) : (
                    <a
                      key={a.id}
                      href={attachmentUrl(org, a.id, true)}
                      className="flex max-w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
                    >
                      <FileText className="size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="block text-xs text-fg-muted">{formatBytes(a.sizeBytes)}</span>
                      </span>
                    </a>
                  ),
                )}
              </div>
            ) : null}
            {m.refs.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {m.refs.map((r) => (
                  <Link
                    key={r.id}
                    href={r.path}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs hover:bg-surface-2"
                  >
                    <Link2 className="size-3 shrink-0" />
                    <span className="text-fg-muted">
                      {{ task: "Tarefa", project: "Projeto", design: "Arte", file: "Arquivo", client: "Cliente" }[
                        r.type
                      ] ?? "Link"}
                      :
                    </span>
                    <span className="truncate">{r.label}</span>
                  </Link>
                ))}
              </div>
            ) : null}
            {m.task ? (
              <button
                type="button"
                onClick={() => onOpenTask(m.task!.id)}
                className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs hover:bg-surface-3"
              >
                <ListPlus className="size-3.5 shrink-0" />
                <span className="text-fg-muted">Tarefa:</span>
                <span className={cn("truncate font-medium", m.task.done && "line-through")}>{m.task.title}</span>
              </button>
            ) : null}
            {m.reactions.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {m.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    title={r.names.join(", ")}
                    aria-pressed={r.mine}
                    onClick={() => void chat.react(m.id, r.emoji).catch((e: Error) => toast.error(e.message))}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
                      r.mine ? "border-accent bg-accent/15" : "border-border bg-surface hover:bg-surface-2",
                    )}
                  >
                    <span>{r.emoji}</span>
                    <span className="tabular">{r.count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
        <div className="flex items-center gap-1 text-[10px] text-fg-subtle">
          {m.editedAt && !deleted ? <span title={new Date(m.editedAt).toLocaleString("pt-BR")}>(editada)</span> : null}
          {mine && !deleted && conv.kind === "direct" ? (
            <span className="inline-flex items-center gap-0.5" title={readByOther ? "Lida" : "Enviada"}>
              {readByOther ? <CheckCheck className="size-3 text-accent-text" /> : <Check className="size-3" />}
              <span className="sr-only">{readByOther ? "Lida" : "Enviada"}</span>
            </span>
          ) : null}
        </div>
      </div>

      {deleted ? null : (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Reagir">
                <SmilePlus />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto flex-wrap gap-1 p-1.5" align="end">
              {CHAT_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="rounded p-1 text-lg hover:bg-surface-2"
                  onClick={() => void chat.react(m.id, e).catch((err: Error) => toast.error(err.message))}
                  aria-label={`Reagir com ${e}`}
                >
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon-xs" aria-label="Responder" onClick={onReply} disabled={!conv.canPost}>
            <Reply />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Mais ações da mensagem">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {m.body ? (
                <DropdownMenuItem onSelect={() => void copyText()}>
                  <Copy /> Copiar texto
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => void copyLink()}>
                <Link2 /> Copiar link da mensagem
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCreateTask}>
                <ListPlus /> Criar tarefa
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onLinkTask}>
                <Link2 /> Vincular a uma tarefa
              </DropdownMenuItem>
              {mine ? (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Editar
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <ConfirmDialog
                  title="Apagar mensagem?"
                  description={
                    mine
                      ? "A mensagem fica como “mensagem apagada” para todos e os anexos são removidos."
                      : "Você está apagando a mensagem de outra pessoa como moderador(a). A ação fica registrada no histórico de auditoria."
                  }
                  confirmLabel="Apagar"
                  onConfirm={() => chat.remove(m.id).catch((e: Error) => toast.error(e.message))}
                  trigger={
                    <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                      <Trash2 /> Apagar
                    </DropdownMenuItem>
                  }
                />
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

function PendingItem({
  p,
  nameOf,
  me,
  onRetry,
  onDiscard,
}: {
  p: PendingMessage;
  nameOf: (id: string) => string | undefined;
  me: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-1 flex gap-2.5 px-1.5 py-0.5 opacity-80">
      <div className="w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        {p.body ? <MessageBody body={p.body} nameOf={nameOf} me={me} /> : null}
        {p.attachments.length ? (
          <p className="text-xs text-fg-muted">{p.attachments.map((a) => a.name).join(", ")}</p>
        ) : null}
        {p.status === "sending" ? (
          <p className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <Spinner className="size-3" /> Enviando…
          </p>
        ) : (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-[11px] text-danger">
            Não enviada{p.error ? `: ${p.error}` : ""}
            <button type="button" className="inline-flex items-center gap-0.5 font-medium underline" onClick={onRetry}>
              <RotateCcw className="size-3" /> Tentar de novo
            </button>
            <button type="button" className="font-medium underline" onClick={onDiscard}>
              Descartar
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function ConversationSearch({
  org,
  conversationId,
  onPick,
  onClose,
}: {
  org: string;
  conversationId: string;
  onPick: (seq: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<
    { id: string; seq: number; body: string; authorName: string | null; createdAt: string }[] | null
  >(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const id = setTimeout(() => {
      chatGet<typeof rows & object>("/api/chat/search", { org, q, c: conversationId }, controller.signal)
        .then((r) => setRows(r))
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [q, org, conversationId]);
  return (
    <div className="border-b border-border bg-surface-2/50 px-3 py-2 sm:px-4">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nesta conversa"
          className="h-8"
          aria-label="Buscar nesta conversa"
        />
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Fechar busca">
          <X />
        </Button>
      </div>
      {rows && q.trim().length >= 2 ? (
        <ul className="mt-2 max-h-48 overflow-y-auto text-sm">
          {rows.length ? (
            rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-surface-2"
                  onClick={() => onPick(r.seq)}
                >
                  <span className="text-xs text-fg-muted">
                    {r.authorName ?? "Alguém"} · {new Date(r.createdAt).toLocaleString("pt-BR")}
                  </span>
                  <span className="block truncate">{r.body.replace(MENTION_RE, "@…")}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-2 py-1.5 text-xs text-fg-muted">Nada encontrado.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Compositor                                                          */
/* ------------------------------------------------------------------ */

function Composer({
  org,
  conv,
  members,
  nameOf,
  chat,
  aiEnabled,
  onAi,
  text,
  setText,
  replyTo,
  setReplyTo,
  editing,
  setEditing,
}: {
  org: string;
  conv: ConversationView;
  members: Member[];
  nameOf: (id: string) => string | undefined;
  chat: ChatController;
  aiEnabled: boolean;
  onAi: (a: ChatAiAction) => void;
  text: string;
  setText: (v: string) => void;
  replyTo: ChatMessageDTO | null;
  setReplyTo: (m: ChatMessageDTO | null) => void;
  editing: ChatMessageDTO | null;
  setEditing: (m: ChatMessageDTO | null) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  // Quem pode ser mencionado: participantes (e, em canal aberto, toda a equipe).
  const candidates = useMemo(() => {
    const ids = new Set(conv.participants.map((p) => p.userId));
    const pool = conv.kind === "channel" && !conv.isPrivate ? members : members.filter((m) => ids.has(m.userId));
    const q = mention?.query.toLowerCase() ?? "";
    return pool.filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [conv, members, mention]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  if (!conv.canPost) {
    return (
      <p className="border-t border-border px-4 py-3 text-center text-sm text-fg-muted">
        {conv.archived
          ? "Esta conversa foi arquivada e não aceita novas mensagens."
          : "Só administradores podem escrever nesta conversa."}
      </p>
    );
  }

  const ready = uploads.filter((u) => u.done).map((u) => u.done!);
  const busy = uploads.some((u) => !u.done && !u.error);

  function encode(raw: string) {
    // "@Nome" escolhido na lista vira <@id> (menção de verdade); o resto fica como texto.
    let out = raw;
    const known = [...new Set(members.map((m) => m.userId))]
      .map((id) => ({ id, name: nameOf(id) }))
      .filter((x): x is { id: string; name: string } => !!x.name)
      .sort((a, b) => b.name.length - a.name.length);
    for (const k of known) out = out.replace(new RegExp(`@${escapeRe(k.name)}(?![\\p{L}\\p{N}])`, "gu"), `<@${k.id}>`);
    return out;
  }

  async function submit() {
    const body = encode(text).trim();
    if (editing) {
      if (!body) return;
      setSaving(true);
      try {
        await chat.edit(editing.id, body);
        setEditing(null);
        setText("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível editar.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if ((!body && !ready.length) || busy) return;
    if (body.length > CHAT_LIMITS.bodyMax) {
      toast.error(`A mensagem passa de ${CHAT_LIMITS.bodyMax} caracteres.`);
      return;
    }
    chat.send(conv.id, body, { replyToId: replyTo?.id ?? null, attachments: ready });
    chat.typing(conv.id, false);
    setText("");
    setReplyTo(null);
    setUploads([]);
    area.current?.focus();
  }

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files).slice(0, CHAT_LIMITS.attachmentsPerMessage - uploads.length)) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      const { promise, abort } = uploadAttachment(org, conv.id, file, (progress) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress } : x))),
      );
      setUploads((u) => [...u, { key, name: file.name, progress: 0, abort }]);
      promise
        .then((done) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, done, progress: 1 } : x))))
        .catch((err: ChatApiError) => {
          if (err.code === "aborted") return;
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: err.message } : x)));
        });
    }
  }

  function onChange(value: string) {
    setText(value);
    if (value.trim()) chat.typing(conv.id, true);
    const caret = area.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([\p{L}\p{N}_.-]{0,30})$/u);
    if (m) {
      setMention({ query: m[2]!, start: caret - m[2]!.length - 1 });
      setMentionIndex(0);
    } else setMention(null);
  }

  function pickMention(member: Member) {
    if (!mention) return;
    const caret = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${member.name} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + member.name.length + 2;
      area.current?.setSelectionRange(pos, pos);
      area.current?.focus();
    });
  }

  return (
    <div
      className="border-t border-border px-3 pt-2 pb-3 sm:px-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {replyTo || editing ? (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              {editing ? "Editando mensagem" : `Respondendo a ${replyTo!.authorName ?? "alguém"}`}
            </span>
            {replyTo ? (
              <span className="block truncate text-fg-muted">
                {replyTo.body.replace(MENTION_RE, (_, id: string) => `@${nameOf(id) ?? "alguém"}`)}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            aria-label="Cancelar"
            onClick={() => {
              if (editing) setText("");
              setReplyTo(null);
              setEditing(null);
            }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {uploads.length ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={cn(
                "flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs",
                u.error ? "border-danger/50 text-danger" : "border-border",
              )}
            >
              <Paperclip className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate">{u.name}</span>
              {u.error ? (
                <span role="alert">{u.error}</span>
              ) : u.done ? (
                <Check className="size-3.5 text-success" aria-label="Enviado" />
              ) : (
                <span className="tabular text-fg-muted" aria-label="Progresso do envio">
                  {Math.round(u.progress * 100)}%
                </span>
              )}
              <button
                type="button"
                aria-label={`Remover ${u.name}`}
                onClick={() => {
                  if (!u.done && !u.error) u.abort();
                  setUploads((x) => x.filter((y) => y.key !== u.key));
                }}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative flex items-end gap-1.5">
        {mention && candidates.length ? (
          <ul
            role="listbox"
            aria-label="Mencionar"
            className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
          >
            {candidates.map((c, i) => (
              <li key={c.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(c);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    i === mentionIndex ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  <Avatar name={c.name} src={c.image} size="xs" />
                  <span className="truncate">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {editing ? null : (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              data-testid="chat-file-input"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Anexar arquivo"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip />
            </Button>
          </>
        )}
        <Textarea
          ref={area}
          rows={1}
          value={text}
          aria-label="Mensagem"
          placeholder={`Mensagem para ${conv.kind === "channel" ? "#" : ""}${conv.name}`}
          className="max-h-[200px] min-h-9 flex-1 resize-none py-1.5"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => chat.typing(conv.id, false)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (mention && candidates.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % candidates.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[mentionIndex]!);
                return;
              }
              if (e.key === "Escape") {
                setMention(null);
                return;
              }
            }
            if (e.key === "Escape" && (editing || replyTo)) {
              if (editing) setText("");
              setEditing(null);
              setReplyTo(null);
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {aiEnabled && !editing ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="IA para a mensagem">
                <Sparkles />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onAi("rewrite")} disabled={!text.trim()}>
                {AI_ACTION_LABEL.rewrite}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAi("reply")}>{AI_ACTION_LABEL.reply}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button
          variant="primary"
          size="icon-sm"
          aria-label={editing ? "Salvar edição" : "Enviar"}
          loading={saving}
          disabled={busy || (!text.trim() && !ready.length)}
          onClick={() => void submit()}
        >
          {editing ? <Check /> : <SendHorizontal />}
        </Button>
      </div>
      <p className="mt-1 hidden text-[11px] text-fg-subtle sm:block">
        Enter envia · Shift+Enter quebra a linha · **negrito** _itálico_ `código` · @ para mencionar
      </p>
    </div>
  );
}
