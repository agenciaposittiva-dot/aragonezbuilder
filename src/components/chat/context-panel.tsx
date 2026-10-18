"use client";

import { ExternalLink, FileText, ListChecks, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
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
import { Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useOrgAction } from "@/hooks/use-action";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addParticipantsAction,
  conversationPanelAction,
  removeParticipantAction,
  taskSummaryAction,
  updateConversationAction,
} from "@/server/actions/chat";
import { PhotoEditor, postPhoto } from "@/components/brand/photo-editor";
import { attachmentUrl, chatSend, type ConversationView, type Presence } from "./api";
import type { Member } from "./chat-dialogs";
import { ConversationIcon } from "./conversation-icon";
import { presenceText } from "./conversation-pane";

type Ok<F extends (...args: never[]) => Promise<unknown>> =
  Extract<Awaited<ReturnType<F>>, { ok: true }> extends {
    data: infer D;
  }
    ? D
    : never;
type PanelData = Ok<typeof conversationPanelAction>;

const ROLE_LABEL: Record<string, string> = { owner: "Criador(a)", admin: "Administra", member: "Participante" };

export function ContextPanel({
  org,
  me,
  conv,
  members,
  presence,
  refreshKey,
  photoMaxBytes,
  onClose,
  onOpenTask,
  onChanged,
}: {
  org: string;
  me: string;
  conv: ConversationView;
  members: Member[];
  presence: Presence[];
  refreshKey: number;
  photoMaxBytes: number;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<PanelData | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useOrgAction(conversationPanelAction, { onSuccess: (d) => setData(d) });
  useEffect(() => {
    void load.run({ conversationId: conv.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id, refreshKey]);
  const remove = useOrgAction(removeParticipantAction, { success: "Pessoa removida", onSuccess: onChanged });
  const canAdd = conv.kind !== "direct" && (conv.moderator || (conv.kind === "group" && conv.joined));
  const images =
    data?.attachments.filter((a) => a.mimeType.startsWith("image/") && a.mimeType !== "image/svg+xml") ?? [];
  const docs = data?.attachments.filter((a) => !images.includes(a)) ?? [];

  return (
    <aside
      aria-label="Detalhes da conversa"
      className="flex h-full min-h-0 w-full flex-col border-l border-border bg-surface lg:w-80"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Detalhes</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar detalhes">
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 text-sm">
        {conv.kind === "group" || conv.kind === "channel" ? (
          <section aria-label={conv.kind === "channel" ? "Foto do canal" : "Foto do grupo"}>
            {conv.canEditPhoto ? (
              <GroupPhoto org={org} conv={conv} maxBytes={photoMaxBytes} onChanged={onChanged} />
            ) : (
              <div className="space-y-2">
                <ConversationIcon kind={conv.kind} name={conv.name} image={conv.image} size="xl" />
                <p className="text-xs text-fg-subtle">
                  Só quem administra {conv.kind === "channel" ? "o canal" : "o grupo"} pode alterar a foto.
                </p>
              </div>
            )}
          </section>
        ) : null}
        <section className="space-y-1">
          <p className="font-semibold break-words">
            {conv.kind === "channel" ? "#" : ""}
            {conv.name}
          </p>
          {conv.topic ? <p className="break-words text-fg-muted">{conv.topic}</p> : null}
          <p className="text-xs text-fg-subtle">
            {conv.department ? `${conv.department} · ` : ""}
            {conv.isPrivate ? "Privado: só participantes" : conv.kind === "channel" ? "Aberto para a equipe" : null}
            {conv.postingPolicy === "admins" ? " · só administradores escrevem" : ""}
          </p>
          {conv.projectId ? (
            <Link
              href={`/w/${org}/projects/${conv.projectId}`}
              className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
            >
              Abrir projeto <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </section>

        {conv.kind !== "direct" && conv.moderator ? <ConversationSettings conv={conv} onChanged={onChanged} /> : null}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Participantes ({conv.participants.length})
            </h3>
            {canAdd ? (
              <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
                <UserPlus /> Adicionar
              </Button>
            ) : null}
          </div>
          <ul className="space-y-1">
            {conv.participants.map((p) => {
              const pr = presence.find((x) => x.userId === p.userId);
              return (
                <li key={p.userId} className="flex items-center gap-2 rounded-md px-1 py-1">
                  <span className="relative">
                    <Avatar name={p.name} src={p.image} size="sm" />
                    {pr?.active ? (
                      <span
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-surface",
                          pr.availability === "available"
                            ? "bg-success"
                            : pr.availability === "busy"
                              ? "bg-danger"
                              : "bg-warning",
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {p.name}
                      {p.userId === me ? " (você)" : ""}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {[ROLE_LABEL[p.role], presenceText(pr)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {conv.moderator && p.userId !== me && conv.kind !== "direct" ? (
                    <ConfirmDialog
                      title={`Remover ${p.name}?`}
                      description="A pessoa deixa de ver a conversa (em canais abertos ela pode entrar de novo). A remoção fica registrada."
                      confirmLabel="Remover"
                      onConfirm={() => remove.run({ conversationId: conv.id, userId: p.userId })}
                      trigger={
                        <Button size="icon-xs" variant="ghost" aria-label={`Remover ${p.name}`}>
                          <X />
                        </Button>
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Tarefas relacionadas</h3>
          {!data ? (
            <Spinner />
          ) : data.tasks.length ? (
            <ul className="space-y-1">
              {data.tasks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask(t.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                  >
                    <ListChecks className="size-4 shrink-0 text-fg-muted" />
                    <span className={cn("min-w-0 flex-1 truncate", t.completedAt && "text-fg-muted line-through")}>
                      {t.title}
                    </span>
                    {t.dueDate ? <span className="text-xs text-fg-subtle">{formatDate(t.dueDate)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-muted">
              Nenhuma tarefa vinculada. Use “Criar tarefa” no menu de uma mensagem.
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Arquivos</h3>
          {!data ? (
            <Spinner />
          ) : data.attachments.length ? (
            <>
              {images.length ? (
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  {images.slice(0, 12).map((a) => (
                    <a key={a.id} href={attachmentUrl(org, a.id)} target="_blank" rel="noopener" title={a.name}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachmentUrl(org, a.id)}
                        alt={a.name}
                        loading="lazy"
                        className="aspect-square w-full rounded-md border border-border object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}
              <ul className="space-y-1">
                {docs.map((a) => (
                  <li key={a.id}>
                    <a
                      href={attachmentUrl(org, a.id, true)}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
                    >
                      <FileText className="size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{a.name}</span>
                        <span className="block text-xs text-fg-subtle">
                          {formatBytes(a.sizeBytes)} · {a.authorName ?? "—"} · {formatDate(a.createdAt)}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-fg-muted">Nenhum arquivo compartilhado.</p>
          )}
        </section>
      </div>
      <AddPeopleDialog open={adding} onOpenChange={setAdding} conv={conv} members={members} onAdded={onChanged} />
    </aside>
  );
}

/** Foto do grupo/canal para quem administra; a troca aparece para todos na próxima sincronização. */
function GroupPhoto({
  org,
  conv,
  maxBytes,
  onChanged,
}: {
  org: string;
  conv: ConversationView;
  maxBytes: number;
  onChanged: () => void;
}) {
  // Mostra a foto recém-salva até a sincronização trazer a mesma informação do servidor.
  const [local, setLocal] = useState<{ src: string | null } | null>(null);
  const [seen, setSeen] = useState(conv.image);
  if (seen !== conv.image) {
    setSeen(conv.image);
    setLocal(null);
  }
  const current = local ? local.src : conv.image;
  const what = conv.kind === "channel" ? "do canal" : "do grupo";
  return (
    <PhotoEditor
      current={current}
      placeholder={<ConversationIcon kind={conv.kind} name={conv.name} image={null} size="xl" />}
      alt={`Foto ${what} ${conv.name}`}
      maxBytes={maxBytes}
      variant="group"
      testId="group-photo"
      layout="stack"
      labels={{
        saved: `Foto ${what} salva`,
        removed: `Foto ${what} removida`,
        kept: `A foto anterior ${what} foi mantida.`,
        removeTitle: `Remover a foto ${what}?`,
        removeDescription: `Volta a aparecer o ícone ${what} para todos os participantes. As mensagens e os participantes não mudam.`,
        dialogDescription: "Arraste para posicionar e use o zoom para enquadrar a imagem.",
        where: "Aparece para todos os participantes na lista de conversas, no cabeçalho e nos avisos.",
      }}
      upload={(file, crop) =>
        postPhoto(
          "/api/chat/photo",
          { org, conversationId: conv.id },
          file,
          crop,
          "Imagem grande demais para a foto do grupo.",
        )
      }
      remove={async () => {
        await chatSend("/api/chat/photo", "DELETE", { org, conversationId: conv.id });
      }}
      onChange={(src) => {
        setLocal({ src });
        onChanged();
      }}
    />
  );
}

function ConversationSettings({ conv, onChanged }: { conv: ConversationView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(conv.name);
  const [topic, setTopic] = useState(conv.topic ?? "");
  const [isPrivate, setPrivate] = useState(conv.isPrivate);
  const [adminsOnly, setAdminsOnly] = useState(conv.postingPolicy === "admins");
  const save = useOrgAction(updateConversationAction, {
    success: "Conversa atualizada",
    onSuccess: () => {
      setOpen(false);
      onChanged();
    },
  });
  const isLinked = conv.kind === "project" || conv.kind === "task";
  return (
    <section>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setName(conv.name);
          setTopic(conv.topic ?? "");
          setPrivate(conv.isPrivate);
          setAdminsOnly(conv.postingPolicy === "admins");
          setOpen(true);
        }}
      >
        Configurar conversa
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Configurar conversa</DialogTitle>
            <DialogDescription>As mudanças ficam registradas no histórico de auditoria.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {isLinked ? null : (
              <Field label="Nome">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </Field>
            )}
            <Field label="Assunto">
              <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} rows={2} />
            </Field>
            {conv.kind === "channel" ? (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Canal privado
                  <span className="block text-xs text-fg-muted">Só participantes veem e entram por convite.</span>
                </span>
                <Switch checked={isPrivate} onCheckedChange={setPrivate} />
              </label>
            ) : null}
            {conv.kind !== "group" ? (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Só administradores escrevem
                  <span className="block text-xs text-fg-muted">Bom para canais de avisos.</span>
                </span>
                <Switch checked={adminsOnly} onCheckedChange={setAdminsOnly} />
              </label>
            ) : null}
          </DialogBody>
          <DialogFooter className="justify-between">
            <ConfirmDialog
              title={conv.archived ? "Reabrir a conversa?" : "Arquivar a conversa?"}
              description={
                conv.archived
                  ? "A conversa volta a aceitar mensagens."
                  : "O histórico continua disponível para os participantes, mas ninguém poderá escrever."
              }
              confirmLabel={conv.archived ? "Reabrir" : "Arquivar"}
              onConfirm={() => save.run({ id: conv.id, archived: !conv.archived })}
              trigger={
                <Button variant="ghost" size="sm">
                  {conv.archived ? "Reabrir" : "Arquivar para todos"}
                </Button>
              }
            />
            <Button
              loading={save.pending}
              onClick={() =>
                save.run({
                  id: conv.id,
                  ...(isLinked ? {} : { name }),
                  topic: topic.trim() || null,
                  ...(conv.kind === "channel" ? { isPrivate } : {}),
                  ...(conv.kind !== "group" ? { postingPolicy: adminsOnly ? "admins" : "all" } : {}),
                })
              }
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AddPeopleDialog({
  open,
  onOpenChange,
  conv,
  members,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conv: ConversationView;
  members: Member[];
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const add = useOrgAction(addParticipantsAction, {
    success: "Pessoas adicionadas",
    onSuccess: () => {
      onOpenChange(false);
      setPicked([]);
      onAdded();
    },
  });
  const inside = new Set(conv.participants.map((p) => p.userId));
  const shown = members.filter((m) => !inside.has(m.userId) && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Adicionar pessoas</DialogTitle>
          <DialogDescription>Só pessoas da equipe com acesso ao chat aparecem aqui.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar pessoa"
            aria-label="Buscar pessoa"
          />
          <ul className="max-h-64 overflow-y-auto rounded-md border border-border">
            {shown.length ? (
              shown.map((m) => {
                const on = picked.includes(m.userId);
                return (
                  <li key={m.userId}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.userId) : [...p, m.userId]))}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2",
                        on && "bg-accent/10",
                      )}
                    >
                      <Avatar name={m.name} src={m.image} size="sm" />
                      <span className="truncate">{m.name}</span>
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="px-3 py-3 text-sm text-fg-muted">Todos já participam.</li>
            )}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button
            disabled={!picked.length}
            loading={add.pending}
            onClick={() => add.run({ conversationId: conv.id, userIds: picked })}
          >
            Adicionar {picked.length ? `(${picked.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tarefa aberta por cima da conversa (sem sair dela). */
export function TaskPeek({
  org,
  taskId,
  onOpenChange,
}: {
  org: string;
  taskId: string | null;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={!!taskId} onOpenChange={onOpenChange}>
      <SheetContent width="md">{taskId ? <TaskPeekBody key={taskId} org={org} taskId={taskId} /> : null}</SheetContent>
    </Sheet>
  );
}

function TaskPeekBody({ org, taskId }: { org: string; taskId: string }) {
  type Summary = Ok<typeof taskSummaryAction>;
  const [task, setTask] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useOrgAction(taskSummaryAction, {
    onSuccess: (d) => setTask(d),
    onError: (msg) => setError(msg),
  });
  useEffect(() => {
    void load.run({ taskId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  return (
    <>
      <div className="border-b border-border px-5 py-4 pr-12">
        <SheetTitle className="text-base font-semibold break-words">{task?.title ?? "Tarefa"}</SheetTitle>
        <SheetDescription className="text-xs text-fg-muted">
          {task ? `${task.clientName} · ${task.projectName}` : "Carregando…"}
        </SheetDescription>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : !task ? (
          <Spinner />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge name={task.statusName} color={task.statusColor} />
              {task.completedAt ? <span className="text-xs text-success">Concluída</span> : null}
              {task.dueDate ? <span className="text-xs text-fg-muted">Prazo: {formatDate(task.dueDate)}</span> : null}
              {task.checklistTotal ? (
                <span className="text-xs text-fg-muted">
                  Checklist: {task.checklistDone}/{task.checklistTotal}
                </span>
              ) : null}
            </div>
            <p className="flex items-center gap-2">
              {task.assigneeName ? (
                <>
                  <Avatar name={task.assigneeName} src={task.assigneeImage} size="xs" /> {task.assigneeName}
                </>
              ) : (
                <span className="text-fg-muted">Sem responsável</span>
              )}
            </p>
            {task.description ? <p className="whitespace-pre-wrap text-fg-muted">{task.description}</p> : null}
            <Button asChild variant="secondary" size="sm">
              <a href={`/w/${org}/tasks/${task.id}`} target="_blank" rel="noopener">
                Abrir tarefa completa <ExternalLink />
              </a>
            </Button>
          </>
        )}
      </div>
    </>
  );
}
