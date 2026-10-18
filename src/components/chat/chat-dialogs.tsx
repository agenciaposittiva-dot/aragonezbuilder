"use client";

import { Hash, Lock, Search, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { Markdown } from "@/components/app/markdown";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrgAction } from "@/hooks/use-action";
import type { AiPreference, AiSelection, PickerProvider } from "@/lib/ai-select";
import type { AiTask } from "@/lib/ai-tasks";
import { CHAT_DEPARTMENTS, plainText } from "@/lib/chat-format";
import { cn } from "@/lib/utils";
import {
  createChannelAction,
  createDefaultChannelsAction,
  createGroupAction,
  createSuggestedChatTasksAction,
  createTaskFromMessageAction,
  findTasksAction,
  joinConversationAction,
  linkMessageTaskAction,
  listChannelsAction,
  openDirectAction,
} from "@/server/actions/chat";
import { ChatApiError, chatSend, type ChatMessageDTO } from "./api";

export type Member = { userId: string; name: string; image: string | null; jobTitle: string | null; roleName: string };
export type Assignee = { membershipId: string; name: string };
export type ProjectOption = { id: string; name: string; clientName: string };
export type AiConfig = {
  allowed: boolean;
  contextAllowed: boolean;
  canConfigure: boolean;
  providers: PickerProvider[];
  preferences: AiPreference[];
};

function PeoplePicker({
  members,
  me,
  selected,
  onToggle,
  single,
}: {
  members: Member[];
  me: string;
  selected: string[];
  onToggle: (id: string) => void;
  single?: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = members
    .filter((m) => m.userId !== me)
    .filter(
      (m) =>
        !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.jobTitle?.toLowerCase().includes(q.toLowerCase()),
    );
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-fg-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar pessoa"
          className="pl-8"
          aria-label="Buscar pessoa"
        />
      </div>
      <ul
        className="max-h-64 overflow-y-auto rounded-md border border-border"
        role="listbox"
        aria-multiselectable={!single}
      >
        {shown.length ? (
          shown.map((m) => {
            const on = selected.includes(m.userId);
            return (
              <li key={m.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => onToggle(m.userId)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-2",
                    on && "bg-accent/10",
                  )}
                >
                  {single ? null : <Checkbox checked={on} tabIndex={-1} aria-hidden />}
                  <Avatar name={m.name} src={m.image} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className="block truncate text-xs text-fg-muted">{m.jobTitle || m.roleName}</span>
                  </span>
                </button>
              </li>
            );
          })
        ) : (
          <li className="px-3 py-4 text-sm text-fg-muted">Ninguém encontrado.</li>
        )}
      </ul>
    </div>
  );
}

/** Nova conversa: direta, grupo ou canal (canal só para quem administra canais). */
export function NewConversationDialog({
  open,
  onOpenChange,
  members,
  me,
  canManageChannels,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: Member[];
  me: string;
  canManageChannels: boolean;
  onCreated: (id: string) => void;
}) {
  const [tab, setTab] = useState("direct");
  const [people, setPeople] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [department, setDepartment] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const done = (d: { id: string }) => {
    onOpenChange(false);
    setPeople([]);
    setName("");
    setTopic("");
    onCreated(d.id);
  };
  const direct = useOrgAction(openDirectAction, { onSuccess: done });
  const group = useOrgAction(createGroupAction, { success: "Grupo criado", onSuccess: done });
  const channel = useOrgAction(createChannelAction, { success: "Canal criado", onSuccess: done });
  const toggle = (id: string) =>
    setPeople((p) => (tab === "direct" ? [id] : p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>Converse com uma pessoa, crie um grupo ou um canal da equipe.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              setPeople([]);
            }}
          >
            <TabsList>
              <TabsTrigger value="direct">Pessoa</TabsTrigger>
              <TabsTrigger value="group">Grupo</TabsTrigger>
              {canManageChannels ? <TabsTrigger value="channel">Canal</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="direct" className="mt-4">
              <PeoplePicker members={members} me={me} selected={people} onToggle={toggle} single />
            </TabsContent>
            <TabsContent value="group" className="mt-4 grid gap-3">
              <Field label="Nome do grupo" htmlFor="chat-group-name" error={group.fieldErrors.name}>
                <Input id="chat-group-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </Field>
              <PeoplePicker members={members} me={me} selected={people} onToggle={toggle} />
            </TabsContent>
            {canManageChannels ? (
              <TabsContent value="channel" className="mt-4 grid gap-3">
                <Field label="Nome do canal" htmlFor="chat-channel-name" error={channel.fieldErrors.name}>
                  <Input id="chat-channel-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </Field>
                <Field label="Departamento" htmlFor="chat-channel-dept">
                  <NativeSelect
                    id="chat-channel-dept"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    <option value="">Sem departamento</option>
                    {CHAT_DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Assunto (opcional)" htmlFor="chat-channel-topic">
                  <Input
                    id="chat-channel-topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={300}
                  />
                </Field>
                <label className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="block font-medium">Canal privado</span>
                    <span className="block text-xs text-fg-muted">
                      Só quem for adicionado vê. Canais abertos podem ser encontrados por toda a equipe.
                    </span>
                  </span>
                  <Switch checked={isPrivate} onCheckedChange={setPrivate} aria-label="Canal privado" />
                </label>
                <PeoplePicker members={members} me={me} selected={people} onToggle={toggle} />
              </TabsContent>
            ) : null}
          </Tabs>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {tab === "direct" ? (
            <Button
              variant="primary"
              disabled={!people[0]}
              loading={direct.pending}
              onClick={() => direct.run({ userId: people[0]! })}
            >
              Conversar
            </Button>
          ) : tab === "group" ? (
            <Button
              variant="primary"
              disabled={!name.trim() || !people.length}
              loading={group.pending}
              onClick={() => group.run({ name, userIds: people })}
            >
              Criar grupo
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!name.trim()}
              loading={channel.pending}
              onClick={() =>
                channel.run({ name, topic: topic || null, department: department || null, isPrivate, userIds: people })
              }
            >
              Criar canal
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ChannelRow = {
  id: string;
  name: string | null;
  topic: string | null;
  department: string | null;
  isPrivate: boolean;
  members: number;
  joined: boolean;
};

/** Canais da equipe: entrar nos abertos; sugestão de canais por departamento. */
export function ChannelBrowserDialog({
  open,
  onOpenChange,
  canManageChannels,
  onOpenConversation,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canManageChannels: boolean;
  onOpenConversation: (id: string) => void;
}) {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const load = useOrgAction(listChannelsAction, { onSuccess: (d) => setRows(d as ChannelRow[]) });
  const join = useOrgAction(joinConversationAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      onOpenConversation(d.id);
    },
  });
  const defaults = useOrgAction(createDefaultChannelsAction, {
    success: (d) => (d.created.length ? `Canais criados: ${d.created.join(", ")}` : "Os canais sugeridos já existem"),
    onSuccess: () => load.run({}),
  });
  useEffect(() => {
    if (open) void load.run({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Canais da equipe</DialogTitle>
          <DialogDescription>Canais por departamento e assunto. Entre nos que interessam a você.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          {rows === null ? (
            <p className="text-sm text-fg-muted">Carregando…</p>
          ) : rows.length ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  {c.isPrivate ? (
                    <Lock className="size-4 text-fg-subtle" />
                  ) : (
                    <Hash className="size-4 text-fg-subtle" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {[c.department, c.topic, `${c.members} ${c.members === 1 ? "pessoa" : "pessoas"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {c.joined ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => (onOpenChange(false), onOpenConversation(c.id))}
                    >
                      Abrir
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" loading={join.pending} onClick={() => join.run({ id: c.id })}>
                      Entrar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">Ainda não há canais.</p>
          )}
          {canManageChannels ? (
            <div className="rounded-md bg-surface-2 p-3 text-sm">
              <p className="font-medium">Canais sugeridos</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {CHAT_DEPARTMENTS.join(", ")} — abertos para toda a equipe.
              </p>
              <Button size="sm" className="mt-2" loading={defaults.pending} onClick={() => defaults.run({})}>
                Criar canais sugeridos
              </Button>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Criar tarefa a partir de uma mensagem (campos revisados pela pessoa antes de criar). */
export function TaskFromMessageDialog({
  message,
  onOpenChange,
  projects,
  assignees,
  canAssign,
  myMembershipId,
  defaultProjectId,
  nameOf,
  onCreated,
}: {
  message: ChatMessageDTO | null;
  onOpenChange: (v: boolean) => void;
  projects: ProjectOption[];
  assignees: Assignee[];
  canAssign: boolean;
  myMembershipId: string;
  defaultProjectId: string | null;
  nameOf: (id: string) => string | undefined;
  onCreated: () => void;
}) {
  const text = message ? plainText(message.body, nameOf).trim() : "";
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  useEffect(() => {
    if (!message) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia o formulário a cada mensagem escolhida
    setTitle(text.split("\n")[0]!.slice(0, 120));
    setDescription(text);
    setProjectId(defaultProjectId ?? "");
    setAssignee("");
    setDue("");
    setPriority("medium");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);
  const create = useOrgAction(createTaskFromMessageAction, {
    success: "Tarefa criada e vinculada à mensagem",
    onSuccess: () => {
      onOpenChange(false);
      onCreated();
    },
  });
  const people = canAssign ? assignees : assignees.filter((a) => a.membershipId === myMembershipId);
  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Criar tarefa a partir da mensagem</DialogTitle>
          <DialogDescription>Revise os campos. Nada é criado sem a sua confirmação.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <Field label="Projeto" htmlFor="chat-task-project" error={create.fieldErrors.projectId}>
            <NativeSelect id="chat-task-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Escolha o projeto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} · {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Título" htmlFor="chat-task-title" error={create.fieldErrors.title}>
            <Input id="chat-task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </Field>
          <Field label="Descrição" htmlFor="chat-task-desc">
            <Textarea
              id="chat-task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Responsável" htmlFor="chat-task-assignee">
              <NativeSelect id="chat-task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Sem responsável</option>
                {people.map((a) => (
                  <option key={a.membershipId} value={a.membershipId}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prazo" htmlFor="chat-task-due" error={create.fieldErrors.dueDate}>
              <Input id="chat-task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Field label="Prioridade" htmlFor="chat-task-priority">
              <NativeSelect
                id="chat-task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
              >
                <option value="urgent">Urgente</option>
                <option value="high">Alta</option>
                <option value="medium">Normal</option>
                <option value="low">Baixa</option>
              </NativeSelect>
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!projectId || !title.trim()}
            loading={create.pending}
            onClick={() =>
              message &&
              create.run({
                messageId: message.id,
                projectId,
                title,
                description,
                assigneeMembershipId: assignee || null,
                dueDate: due || null,
                priority,
              })
            }
          >
            Criar tarefa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Vincular uma tarefa existente à mensagem. */
export function LinkTaskDialog({
  message,
  onOpenChange,
  onLinked,
}: {
  message: ChatMessageDTO | null;
  onOpenChange: (v: boolean) => void;
  onLinked: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; title: string; projectName: string; clientName: string }[]>([]);
  const find = useOrgAction(findTasksAction, { onSuccess: (d) => setRows(d) });
  const link = useOrgAction(linkMessageTaskAction, {
    success: "Tarefa vinculada",
    onSuccess: () => {
      onOpenChange(false);
      onLinked();
    },
  });
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => void find.run({ q }), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, message?.id]);
  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Vincular a uma tarefa</DialogTitle>
          <DialogDescription>A mensagem passa a mostrar a tarefa, e a conversa registra o vínculo.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar tarefa"
            aria-label="Buscar tarefa"
          />
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {rows.length ? (
              rows.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-surface-2"
                    onClick={() => message && link.run({ messageId: message.id, taskId: t.id })}
                  >
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {t.clientName} · {t.projectName}
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-4 text-sm text-fg-muted">
                {find.pending ? "Buscando…" : "Nenhuma tarefa encontrada."}
              </li>
            )}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* IA                                                                  */
/* ------------------------------------------------------------------ */

export type ChatAiAction = "summary" | "catch_up" | "decisions" | "tasks" | "reply" | "rewrite" | "ask";

export const AI_ACTION_LABEL: Record<ChatAiAction, string> = {
  catch_up: "Resumir desde a minha última visita",
  summary: "Resumir a conversa",
  decisions: "Organizar decisões e pendências",
  tasks: "Sugerir tarefas da conversa",
  reply: "Preparar uma resposta",
  rewrite: "Reescrever minha mensagem",
  ask: "Perguntar às conversas",
};

const AI_TASK_OF: Record<ChatAiAction, AiTask> = {
  catch_up: "summary",
  summary: "summary",
  decisions: "summary",
  tasks: "structured",
  reply: "chat",
  rewrite: "chat",
  ask: "chat",
};

type AiResult = { text: string; data: unknown; model: string; provider: string; demo: boolean; notice: string | null };

/**
 * IA no chat: escolhe o modelo, mostra o resultado e — para tarefas — pede
 * revisão antes de criar. Respeita a autorização da organização.
 */
export function ChatAiDialog({
  org,
  action,
  onOpenChange,
  conversationId,
  draft,
  ai,
  projects,
  defaultProjectId,
  onUseText,
  onTasksCreated,
}: {
  org: string;
  action: ChatAiAction | null;
  onOpenChange: (v: boolean) => void;
  conversationId: string;
  draft: string;
  ai: AiConfig;
  projects: ProjectOption[];
  defaultProjectId: string | null;
  onUseText: (text: string) => void;
  onTasksCreated: () => void;
}) {
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<"conversation" | "all">("conversation");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costPrompt, setCostPrompt] = useState<string | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const createTasks = useOrgAction(createSuggestedChatTasksAction, {
    success: (d) => `${d.created} tarefa(s) criada(s)`,
    onSuccess: () => {
      onOpenChange(false);
      onTasksCreated();
    },
  });

  useEffect(() => {
    if (!action) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia o diálogo a cada ação escolhida
    setResult(null);
    setError(null);
    setCostPrompt(null);
    setQuestion("");
    setChecked([]);
    setProjectId(defaultProjectId ?? "");
  }, [action, defaultProjectId]);

  const suggestions = useMemo(() => {
    const d = result?.data as { tasks?: { title: string; description: string; estimateMinutes: number }[] } | null;
    return d?.tasks ?? [];
  }, [result]);

  const blocked = action && action !== "rewrite" && !ai.contextAllowed;

  async function run(confirmCost = false) {
    if (!action) return;
    setRunning(true);
    setError(null);
    setCostPrompt(null);
    try {
      const data = await chatSend<AiResult>("/api/chat/ai", "POST", {
        org,
        conversationId,
        action,
        draft: draft || undefined,
        question: question || undefined,
        scope,
        selection,
        confirmCost,
      });
      setResult(data);
      const d = data.data as { tasks?: unknown[] } | null;
      if (d?.tasks) setChecked(d.tasks.map((_, i) => i));
    } catch (err) {
      const e = err instanceof ChatApiError ? err : null;
      if (e?.code === "cost_confirmation") setCostPrompt(e.message);
      else setError(e?.message ?? "A IA não respondeu. Tente novamente.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={!!action} onOpenChange={(v) => !running && onOpenChange(v)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent-text" /> {action ? AI_ACTION_LABEL[action] : ""}
          </DialogTitle>
          <DialogDescription>
            {action === "rewrite"
              ? "Só o texto que você escreveu é enviado ao modelo."
              : "Só as mensagens que você pode ver são usadas. A conversa não fica guardada no histórico de IA."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {!ai.allowed ? (
            <p className="text-sm text-fg-muted">Você não tem acesso ao assistente de IA.</p>
          ) : blocked ? (
            <p role="alert" className="rounded-md bg-surface-2 p-3 text-sm">
              A organização ainda não autorizou a IA a ler conversas do chat.{" "}
              {ai.canConfigure
                ? "Ative em Configurações › Inteligência artificial."
                : "Peça a um administrador para ativar em Configurações › Inteligência artificial."}
            </p>
          ) : (
            <>
              {action === "ask" ? (
                <div className="grid gap-2">
                  <Field label="Pergunta" htmlFor="chat-ai-question">
                    <Textarea
                      id="chat-ai-question"
                      rows={2}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ex.: Qual prazo combinamos para o vídeo de lançamento?"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={scope === "all"}
                      onCheckedChange={(v) => setScope(v === true ? "all" : "conversation")}
                    />
                    Procurar também nas outras conversas que eu posso ver
                  </label>
                </div>
              ) : null}
              {action === "rewrite" && !draft.trim() ? (
                <p className="text-sm text-fg-muted">
                  Escreva a mensagem no campo de texto antes de pedir a reescrita.
                </p>
              ) : null}
              {action ? (
                <AiModelPicker
                  providers={ai.providers}
                  preferences={ai.preferences}
                  task={AI_TASK_OF[action]}
                  module="chat"
                  value={selection}
                  onChange={setSelection}
                  disabled={running}
                />
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              {costPrompt ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 p-3 text-sm"
                >
                  <span>{costPrompt}</span>
                  <Button size="sm" variant="primary" onClick={() => run(true)} loading={running}>
                    Confirmar e gerar
                  </Button>
                </div>
              ) : null}
              {result ? (
                <div className="grid gap-2 rounded-md border border-border p-3">
                  <p className="text-xs text-fg-muted">
                    {result.demo ? "Exemplo da demonstração (sem IA real)" : `${result.provider} · ${result.model}`}
                    {result.notice ? ` · ${result.notice}` : ""}
                  </p>
                  {action === "tasks" ? (
                    suggestions.length ? (
                      <div className="grid gap-2">
                        <ul className="grid gap-1.5">
                          {suggestions.map((t, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <Checkbox
                                checked={checked.includes(i)}
                                onCheckedChange={(v) =>
                                  setChecked((c) => (v === true ? [...c, i] : c.filter((x) => x !== i)))
                                }
                                aria-label={t.title}
                                className="mt-0.5"
                              />
                              <span>
                                <span className="block font-medium">{t.title}</span>
                                {t.description ? (
                                  <span className="block text-xs text-fg-muted">{t.description}</span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <Field label="Criar no projeto" htmlFor="chat-ai-project">
                          <NativeSelect
                            id="chat-ai-project"
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                          >
                            <option value="">Escolha o projeto</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.clientName} · {p.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                      </div>
                    ) : (
                      <p className="text-sm text-fg-muted">A IA não encontrou tarefas combinadas nesta conversa.</p>
                    )
                  ) : (
                    <Markdown text={result.text} className="text-sm" />
                  )}
                </div>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={running}>
            Fechar
          </Button>
          {ai.allowed && !blocked ? (
            result && action === "tasks" && suggestions.length ? (
              <Button
                variant="primary"
                disabled={!projectId || !checked.length}
                loading={createTasks.pending}
                onClick={() =>
                  createTasks.run({
                    conversationId,
                    projectId,
                    tasks: checked.map((i) => ({
                      title: suggestions[i]!.title,
                      description: suggestions[i]!.description,
                      estimateMinutes: suggestions[i]!.estimateMinutes || null,
                    })),
                  })
                }
              >
                Criar {checked.length} tarefa(s)
              </Button>
            ) : result && (action === "reply" || action === "rewrite") ? (
              <Button
                variant="primary"
                onClick={() => {
                  onUseText(result.text.trim());
                  onOpenChange(false);
                  toast.success("Texto colocado no campo de mensagem. Revise antes de enviar.");
                }}
              >
                Usar no campo de mensagem
              </Button>
            ) : (
              <Button
                variant="primary"
                loading={running}
                disabled={(action === "ask" && !question.trim()) || (action === "rewrite" && !draft.trim())}
                onClick={() => run(false)}
              >
                {result ? "Gerar de novo" : "Gerar"}
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GroupIcon({ kind, className }: { kind: string; className?: string }) {
  return kind === "channel" ? <Hash className={className} /> : <Users className={className} />;
}
