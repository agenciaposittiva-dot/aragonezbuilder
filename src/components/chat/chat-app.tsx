"use client";

import { AtSign, BellOff, BellRing, Hash, MessageSquarePlus, Pin, Search, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useOrgAction } from "@/hooks/use-action";
import { excerpt, MENTION_RE } from "@/lib/chat-format";
import { cn } from "@/lib/utils";
import { setAvailabilityAction } from "@/server/actions/chat";
import { chatGet, type ChatMessageDTO, type ConversationSummary } from "./api";
import {
  ChannelBrowserDialog,
  ChatAiDialog,
  LinkTaskDialog,
  NewConversationDialog,
  TaskFromMessageDialog,
  type AiConfig,
  type Assignee,
  type ChatAiAction,
  type Member,
  type ProjectOption,
} from "./chat-dialogs";
import { ContextPanel, TaskPeek } from "./context-panel";
import { ConversationIcon, ConversationPane } from "./conversation-pane";
import { useChat } from "./use-chat";

type Filter = "all" | "unread" | "direct" | "groups" | "channels";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "unread", label: "Não lidas" },
  { key: "direct", label: "Diretas" },
  { key: "groups", label: "Grupos" },
  { key: "channels", label: "Canais e projetos" },
];

const AVAILABILITY = [
  { value: "available", label: "Disponível", dot: "bg-success" },
  { value: "busy", label: "Ocupado(a)", dot: "bg-danger" },
  { value: "away", label: "Ausente", dot: "bg-warning" },
] as const;

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function shortTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diff = (now.getTime() - d.getTime()) / 86_400_000;
  if (diff < 6) return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function parseLocation(org: string) {
  const prefix = `/w/${org}/chat`;
  const rest = location.pathname.startsWith(prefix) ? location.pathname.slice(prefix.length).replace(/^\//, "") : "";
  const id = rest.split("/")[0] || null;
  const m = Number(new URLSearchParams(location.search).get("m"));
  return { id, seq: Number.isFinite(m) && m > 0 ? m : null };
}

export function ChatApp({
  org,
  me,
  initial,
  members,
  projects,
  assignees,
  permissions,
  ai,
  status,
}: {
  org: string;
  me: { userId: string; membershipId: string };
  initial: { conversations: ConversationSummary[]; activeId: string | null; focusSeq: number | null };
  members: Member[];
  projects: ProjectOption[];
  assignees: Assignee[];
  permissions: { canManageChannels: boolean; canAssign: boolean; canCreateTasks: boolean };
  ai: AiConfig;
  status: { availability: string; showLastSeen: boolean };
}) {
  const chat = useChat(org, { conversations: initial.conversations, activeId: initial.activeId });
  const wide = useMedia("(min-width: 1280px)");
  const [panelOpen, setPanelOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [focusSeq, setFocusSeq] = useState<number | null>(initial.focusSeq);
  const [aiAction, setAiAction] = useState<ChatAiAction | null>(null);
  const [taskFrom, setTaskFrom] = useState<ChatMessageDTO | null>(null);
  const [linkFrom, setLinkFrom] = useState<ChatMessageDTO | null>(null);
  const [peekTask, setPeekTask] = useState<string | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [myStatus, setMyStatus] = useState(status);
  const [notifPermission, setNotifPermission] = useState<string>("unsupported");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- só disponível no navegador
    if (typeof Notification !== "undefined") setNotifPermission(Notification.permission);
  }, []);

  const nameMap = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const nameOf = useCallback((id: string) => nameMap.get(id), [nameMap]);

  const activeId = chat.active?.id ?? null;
  const summary = chat.list.find((c) => c.id === activeId);
  const conv = chat.active?.conversation ?? null;

  const openConversation = useCallback(
    (id: string | null, opts: { seq?: number | null; replace?: boolean } = {}) => {
      if (id !== activeId) chat.open(id);
      setFocusSeq(opts.seq ?? null);
      const url = id ? `/w/${org}/chat/${id}${opts.seq ? `?m=${opts.seq}` : ""}` : `/w/${org}/chat`;
      if (location.pathname + location.search !== url) {
        if (opts.replace) history.replaceState(null, "", url);
        else history.pushState(null, "", url);
      }
    },
    [activeId, chat, org],
  );

  // Voltar/avançar do navegador.
  useEffect(() => {
    const onPop = () => {
      const { id, seq } = parseLocation(org);
      chat.open(id);
      setFocusSeq(seq);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [chat, org]);

  const availability = useOrgAction(setAvailabilityAction, { onSuccess: () => chat.syncNow() });
  const changeStatus = (next: typeof myStatus) => {
    setMyStatus(next);
    void availability.run({
      availability: next.availability as "available" | "busy" | "away",
      showLastSeen: next.showLastSeen,
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chat.list
      .filter((c) => (showHidden ? c.hidden : !c.hidden) || c.id === activeId)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .filter((c) => {
        switch (filter) {
          case "unread":
            return c.unread > 0 || c.id === activeId;
          case "direct":
            return c.kind === "direct";
          case "groups":
            return c.kind === "group";
          case "channels":
            return c.kind === "channel" || c.kind === "project" || c.kind === "task";
          default:
            return true;
        }
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
      });
  }, [chat.list, query, filter, showHidden, activeId]);
  const hiddenCount = chat.list.filter((c) => c.hidden).length;
  const favorites = visible.filter((c) => c.favorite && !c.pinned);

  const showPanel = !!conv && panelOpen;
  const defaultProjectId = conv?.projectId ?? null;
  const aiEnabled = ai.allowed;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden border-border bg-bg sm:-mx-6 lg:-mx-8 lg:border-x">
      {/* Lista de conversas */}
      <section
        aria-label="Conversas"
        className={cn(
          "min-h-0 w-full flex-col border-r border-border bg-surface lg:flex lg:w-80 lg:shrink-0",
          activeId ? "hidden" : "flex",
        )}
      >
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-base font-semibold">Chat da Equipe</h1>
            <StatusMenu status={myStatus} onChange={changeStatus} />
            <Button size="icon-sm" variant="ghost" aria-label="Canais da equipe" onClick={() => setChannelsOpen(true)}>
              <Hash />
            </Button>
            <Button size="icon-sm" aria-label="Nova conversa" onClick={() => setNewOpen(true)}>
              <MessageSquarePlus />
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-fg-subtle" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conversas e mensagens"
              aria-label="Buscar conversas e mensagens"
              className="h-9 pl-8"
            />
            {query ? (
              <button
                type="button"
                aria-label="Limpar busca"
                className="absolute top-2.5 right-2.5"
                onClick={() => setQuery("")}
              >
                <X className="size-4 text-fg-subtle" />
              </button>
            ) : null}
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="Filtrar conversas">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap",
                  filter === f.key
                    ? "border-accent bg-accent/15 font-medium"
                    : "border-border text-fg-muted hover:bg-surface-2",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {notifPermission === "default" ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-3"
              onClick={async () => {
                const p = await Notification.requestPermission();
                setNotifPermission(p);
                if (p === "granted") toast.success("Avisos do navegador ativados para diretas e menções.");
              }}
            >
              <BellRing className="size-3.5 shrink-0" /> Receber avisos do navegador para diretas e menções
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {query.trim().length >= 2 ? (
            <MessageSearch
              org={org}
              query={query}
              nameOf={nameOf}
              onPick={(id, seq) => openConversation(id, { seq })}
            />
          ) : null}
          {favorites.length && filter === "all" && !query ? <ListHeading>Favoritas</ListHeading> : null}
          {filter === "all" && !query
            ? favorites.map((c) => (
                <ConversationRow
                  key={`f-${c.id}`}
                  c={c}
                  me={me.userId}
                  active={c.id === activeId}
                  nameOf={nameOf}
                  onOpen={() => openConversation(c.id)}
                />
              ))
            : null}
          {favorites.length && filter === "all" && !query ? <ListHeading>Conversas</ListHeading> : null}
          {visible.length ? (
            visible
              .filter((c) => !(filter === "all" && !query && c.favorite && !c.pinned))
              .map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  me={me.userId}
                  active={c.id === activeId}
                  nameOf={nameOf}
                  onOpen={() => openConversation(c.id)}
                />
              ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-fg-muted">
              {chat.list.length ? (
                "Nenhuma conversa neste filtro."
              ) : (
                <>
                  <p className="font-medium text-fg">Comece uma conversa</p>
                  <p className="mt-1">Fale com alguém da equipe, crie um grupo ou entre nos canais.</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button size="sm" onClick={() => setNewOpen(true)}>
                      Nova conversa
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setChannelsOpen(true)}>
                      Ver canais
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {hiddenCount ? (
            <button
              type="button"
              className="w-full px-4 py-2 text-left text-xs text-fg-muted hover:text-fg"
              onClick={() => setShowHidden((v) => !v)}
            >
              {showHidden ? "Voltar às conversas" : `Arquivadas por você (${hiddenCount})`}
            </button>
          ) : null}
        </div>
      </section>

      {/* Conversa */}
      <section
        aria-label="Conversa"
        className={cn("min-h-0 min-w-0 flex-1 flex-col bg-bg lg:flex", activeId ? "flex" : "hidden")}
      >
        {chat.active ? (
          <ConversationPane
            key={chat.active.id}
            org={org}
            me={me}
            chat={chat}
            summary={summary}
            members={members}
            presence={chat.presence}
            onBack={() => openConversation(null)}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            onAi={setAiAction}
            onCreateTask={(m) =>
              permissions.canCreateTasks ? setTaskFrom(m) : toast.error("Você não tem permissão para criar tarefas.")
            }
            onLinkTask={(m) =>
              permissions.canCreateTasks ? setLinkFrom(m) : toast.error("Você não tem permissão para vincular tarefas.")
            }
            onOpenTask={setPeekTask}
            aiEnabled={aiEnabled}
            composerText={drafts[chat.active.id] ?? ""}
            setComposerText={(v) => setDrafts((d) => ({ ...d, [chat.active!.id]: v }))}
            focusSeq={focusSeq}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <AtSign className="size-8 text-fg-subtle" />
            <p className="font-medium">Escolha uma conversa</p>
            <p className="max-w-sm text-sm text-fg-muted">
              Conversas diretas e grupos são privados. Canais abertos aparecem para toda a equipe interna — clientes não
              têm acesso ao chat.
            </p>
          </div>
        )}
      </section>

      {/* Painel contextual */}
      {showPanel && wide ? (
        <ContextPanel
          org={org}
          me={me.userId}
          conv={conv}
          members={members}
          presence={chat.presence}
          refreshKey={panelKey}
          onClose={() => setPanelOpen(false)}
          onOpenTask={setPeekTask}
          onChanged={() => {
            chat.syncNow();
            setPanelKey((k) => k + 1);
          }}
        />
      ) : null}
      {conv && !wide ? (
        <Sheet open={showPanel} onOpenChange={setPanelOpen}>
          <SheetContent width="sm" className="p-0 [&>button:last-child]:hidden">
            <SheetTitle className="sr-only">Detalhes da conversa</SheetTitle>
            <ContextPanel
              org={org}
              me={me.userId}
              conv={conv}
              members={members}
              presence={chat.presence}
              refreshKey={panelKey}
              onClose={() => setPanelOpen(false)}
              onOpenTask={setPeekTask}
              onChanged={() => {
                chat.syncNow();
                setPanelKey((k) => k + 1);
              }}
            />
          </SheetContent>
        </Sheet>
      ) : null}

      <NewConversationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        members={members}
        me={me.userId}
        canManageChannels={permissions.canManageChannels}
        onCreated={(id) => {
          chat.syncNow();
          openConversation(id);
        }}
      />
      <ChannelBrowserDialog
        open={channelsOpen}
        onOpenChange={setChannelsOpen}
        canManageChannels={permissions.canManageChannels}
        onOpenConversation={(id) => {
          chat.syncNow();
          openConversation(id);
        }}
      />
      <TaskFromMessageDialog
        message={taskFrom}
        onOpenChange={(v) => !v && setTaskFrom(null)}
        projects={projects}
        assignees={assignees}
        canAssign={permissions.canAssign}
        myMembershipId={me.membershipId}
        defaultProjectId={defaultProjectId}
        nameOf={nameOf}
        onCreated={() => {
          chat.syncNow();
          setPanelKey((k) => k + 1);
        }}
      />
      <LinkTaskDialog
        message={linkFrom}
        onOpenChange={(v) => !v && setLinkFrom(null)}
        onLinked={() => {
          chat.syncNow();
          setPanelKey((k) => k + 1);
        }}
      />
      {conv ? (
        <ChatAiDialog
          org={org}
          action={aiAction}
          onOpenChange={(v) => !v && setAiAction(null)}
          conversationId={conv.id}
          draft={(drafts[conv.id] ?? "").replace(MENTION_RE, "@…")}
          ai={ai}
          projects={projects}
          defaultProjectId={defaultProjectId}
          onUseText={(text) => setDrafts((d) => ({ ...d, [conv.id]: text }))}
          onTasksCreated={() => {
            chat.syncNow();
            setPanelKey((k) => k + 1);
          }}
        />
      ) : null}
      <TaskPeek org={org} taskId={peekTask} onOpenChange={(v) => !v && setPeekTask(null)} />
    </div>
  );
}

const PATH_LABEL: Record<string, string> = {
  tasks: "(tarefa)",
  projects: "(projeto)",
  studio: "(arte)",
  files: "(arquivo)",
  clients: "(cliente)",
};

/** Prévia legível: links internos viram um rótulo curto em vez do endereço. */
function previewText(body: string, nameOf: (id: string) => string | undefined, max: number) {
  return excerpt(body, nameOf, max * 2)
    .replace(
      /\/w\/[^\s/]+\/(tasks|projects|studio|files|clients)\/[0-9a-f-]{36}\S*/g,
      (_, t: string) => PATH_LABEL[t] ?? "",
    )
    .slice(0, max);
}

function ListHeading({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">{children}</p>;
}

function ConversationRow({
  c,
  me,
  active,
  nameOf,
  onOpen,
}: {
  c: ConversationSummary;
  me: string;
  active: boolean;
  nameOf: (id: string) => string | undefined;
  onOpen: () => void;
}) {
  const preview = c.last
    ? c.last.deleted
      ? "Mensagem apagada"
      : `${c.last.kind === "system" ? "" : c.last.authorId === me ? "Você: " : c.kind === "direct" ? "" : `${(c.last.authorId && nameOf(c.last.authorId)?.split(" ")[0]) || "Alguém"}: `}${previewText(c.last.body, nameOf, 80) || "Anexo"}`
    : (c.topic ?? "Sem mensagens ainda");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      data-testid="chat-conversation"
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
        active ? "bg-accent/15" : "hover:bg-surface-2",
      )}
    >
      <ConversationIcon kind={c.kind} name={c.name} image={c.other?.image ?? null} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>
            {c.kind === "channel" ? "#" : ""}
            {c.name}
          </span>
          {c.pinned ? <Pin className="size-3 shrink-0 text-fg-subtle" aria-label="Fixada" /> : null}
          {c.favorite ? <Star className="size-3 shrink-0 text-fg-subtle" aria-label="Favorita" /> : null}
          {c.muted ? <BellOff className="size-3 shrink-0 text-fg-subtle" aria-label="Silenciada" /> : null}
          <span className="ml-auto shrink-0 pl-1 text-[11px] text-fg-subtle">{shortTime(c.lastMessageAt)}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread ? "text-fg" : "text-fg-muted")}>
            {preview}
          </span>
          {c.mentions ? (
            <span
              className="shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg"
              aria-label={`${c.mentions} menções`}
            >
              @
            </span>
          ) : null}
          {c.unread ? (
            <span
              className={cn(
                "tabular min-w-5 shrink-0 rounded-full px-1.5 text-center text-[10px] font-semibold",
                c.muted ? "bg-surface-3 text-fg-muted" : "bg-accent text-accent-fg",
              )}
              aria-label={`${c.unread} não lidas`}
            >
              {c.unread > 99 ? "99+" : c.unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function StatusMenu({
  status,
  onChange,
}: {
  status: { availability: string; showLastSeen: boolean };
  onChange: (s: { availability: string; showLastSeen: boolean }) => void;
}) {
  const current = AVAILABILITY.find((a) => a.value === status.availability) ?? AVAILABILITY[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Sua disponibilidade: ${current.label}`} className="gap-1.5 px-2">
          <span className={cn("size-2.5 rounded-full", current.dot)} aria-hidden />
          <span className="hidden text-xs sm:inline">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Sua disponibilidade</DropdownMenuLabel>
        {AVAILABILITY.map((a) => (
          <DropdownMenuItem key={a.value} onSelect={() => onChange({ ...status, availability: a.value })}>
            <span className={cn("size-2.5 rounded-full", a.dot)} aria-hidden /> {a.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <label className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
          <span>
            Mostrar quando estive ativo(a)
            <span className="block text-xs text-fg-muted">Desligado, ninguém vê seu “visto por último”.</span>
          </span>
          <Switch checked={status.showLastSeen} onCheckedChange={(v) => onChange({ ...status, showLastSeen: v })} />
        </label>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SearchRow = {
  id: string;
  seq: number;
  body: string;
  createdAt: string;
  authorName: string | null;
  conversationId: string;
  conversationKind: string;
  conversationName: string | null;
};

function MessageSearch({
  org,
  query,
  nameOf,
  onPick,
}: {
  org: string;
  query: string;
  nameOf: (id: string) => string | undefined;
  onPick: (conversationId: string, seq: number) => void;
}) {
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const id = setTimeout(() => {
      chatGet<SearchRow[]>("/api/chat/search", { org, q: query.trim() }, controller.signal)
        .then(setRows)
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [org, query]);
  if (!rows) return null;
  return (
    <div className="border-b border-border pb-1">
      <ListHeading>Mensagens</ListHeading>
      {rows.length ? (
        rows.slice(0, 20).map((r) => (
          <button
            key={r.id}
            type="button"
            data-testid="chat-search-result"
            onClick={() => onPick(r.conversationId, r.seq)}
            className="block w-full px-4 py-1.5 text-left hover:bg-surface-2"
          >
            <span className="block truncate text-xs text-fg-muted">
              {r.conversationKind === "channel" ? "#" : ""}
              {r.conversationName ?? "Conversa"} · {r.authorName ?? "Alguém"} · {shortTime(r.createdAt)}
            </span>
            <span className="block truncate text-sm">{excerpt(r.body, nameOf, 100)}</span>
          </button>
        ))
      ) : (
        <p className="px-4 py-1.5 text-xs text-fg-muted">Nenhuma mensagem encontrada.</p>
      )}
    </div>
  );
}
