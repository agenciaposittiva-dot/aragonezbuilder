"use client";

import { AtSign, Lock, MessageSquare, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/format";
import type { CommentTarget } from "@/lib/validators/comments";
import { cn } from "@/lib/utils";
import { addCommentAction, deleteCommentAction } from "@/server/actions/comments";

export type CommentItem = {
  id: string;
  body: string;
  internal: boolean;
  mentionedMembershipIds?: string[];
  createdAt: Date;
  editedAt: Date | null;
  authorUserId: string | null;
  authorName: string | null;
  authorImage: string | null;
};

/**
 * Comentários de um registro. A equipe escolhe se o comentário é interno
 * (padrão) ou visível ao cliente; o cliente só publica comentários visíveis.
 */
export function Comments({
  target,
  comments,
  allowInternal,
  defaultInternal = true,
  lockInternal = false,
  placeholder = "Escreva um comentário…",
  mentionables,
}: {
  target: CommentTarget;
  comments: CommentItem[];
  allowInternal: boolean;
  defaultInternal?: boolean;
  /** Registros só da equipe (ex.: tarefas): todo comentário é interno, sem opção de torná-lo visível. */
  lockInternal?: boolean;
  placeholder?: string;
  /** Pessoas que podem ser mencionadas com @ (só quem tem acesso ao registro). */
  mentionables?: Mentionable[];
}) {
  const ws = useWorkspace();
  const [body, setBody] = useState("");
  const [internalChoice, setInternal] = useState(allowInternal && defaultInternal);
  const internal = lockInternal || internalChoice;
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const add = useOrgAction(addCommentAction, {
    onSuccess: () => {
      setBody("");
      setPicked([]);
    },
  });
  const names = useMemo(() => new Map((mentionables ?? []).map((m) => [m.membershipId, m.name])), [mentionables]);
  // Só valem as menções cujo "@Nome" continua no texto.
  const submit = () => {
    const mentions = picked.filter((m) => body.includes(`@${m.name}`)).map((m) => m.membershipId);
    add.run({ target, body, internal, mentions: [...new Set(mentions)] });
  };
  const remove = useOrgAction(deleteCommentAction);
  const isAdmin = ws.permissions.includes("org.manage");
  // Convidados só comentam com a permissão explícita (o servidor também confere).
  const canWrite = ws.kind === "internal" || ws.permissions.includes("portal.comment");

  return (
    <div className="grid gap-4">
      {comments.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <MessageSquare className="size-4" /> Nenhum comentário ainda.
        </p>
      ) : (
        <ul className="grid gap-4">
          {comments.map((c) => (
            <li key={c.id} className="group flex gap-3">
              <Avatar name={c.authorName ?? "?"} src={c.authorImage} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium">{c.authorName ?? "Usuário removido"}</span>
                  <span className="text-[11px] text-fg-subtle">{formatDateTime(c.createdAt)}</span>
                  {c.internal ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-1.5 text-[10px] font-medium text-warning">
                      <Lock className="size-2.5" /> Interno
                    </span>
                  ) : null}
                  {c.authorUserId === ws.userId || isAdmin ? (
                    <button
                      type="button"
                      onClick={() => remove.run({ id: c.id })}
                      className="ml-auto text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                      aria-label="Excluir comentário"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <p
                  className={cn(
                    "mt-1 rounded-lg px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap",
                    c.internal ? "border border-dashed border-warning/40 bg-warning-soft/40" : "bg-surface-2",
                  )}
                >
                  <WithMentions
                    body={c.body}
                    names={(c.mentionedMembershipIds ?? []).map((id) => names.get(id)).filter((n): n is string => !!n)}
                  />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) submit();
          }}
        >
          <MentionTextarea
            value={body}
            onChange={setBody}
            placeholder={mentionables?.length ? `${placeholder} Use @ para mencionar alguém.` : placeholder}
            mentionables={mentionables ?? []}
            onPick={(m) => setPicked((p) => (p.some((x) => x.membershipId === m.membershipId) ? p : [...p, m]))}
            onSubmit={() => body.trim() && submit()}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {allowInternal && !lockInternal ? (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <Switch checked={internal} onCheckedChange={setInternal} aria-label="Comentário interno" />
                {internal ? "Interno: só a equipe vê" : "Visível para o cliente"}
              </label>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" variant="primary" loading={add.pending} disabled={!body.trim()}>
              Comentar
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export type Mentionable = { membershipId: string; name: string; image?: string | null };

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Destaca os "@Nome" das pessoas mencionadas (texto puro, sem HTML). */
function WithMentions({ body, names }: { body: string; names: string[] }) {
  if (!names.length) return <>{body}</>;
  const alternatives = [...new Set(names)].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(@(?:${alternatives.join("|")}))`, "g");
  return (
    <>
      {body.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-accent/15 px-0.5 font-medium text-accent-text">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Caixa de texto com sugestões de menção: ao digitar "@" seguido de letras,
 * lista as pessoas que podem ser mencionadas (setas para escolher, Enter/Tab
 * para inserir, Esc para fechar). Ctrl/⌘+Enter envia.
 */
function MentionTextarea({
  value,
  onChange,
  placeholder,
  mentionables,
  onPick,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  mentionables: Mentionable[];
  onPick: (m: Mentionable) => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const options = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return mentionables.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, mentionables]);
  const open = !!query && options.length > 0;

  function detect(text: string, caret: number) {
    if (!mentionables.length) return setQuery(null);
    const before = text.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@][^@\n]{0,30})?$/u);
    if (!m) return setQuery(null);
    const typed = m[1] ?? "";
    setQuery({ start: caret - typed.length - 1, text: typed });
    setActive(0);
  }

  function insert(m: Mentionable) {
    if (!query) return;
    const caret = ref.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${m.name} ${value.slice(caret)}`;
    onChange(next);
    onPick(m);
    setQuery(null);
    const pos = query.start + m.name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        placeholder={placeholder}
        rows={3}
        role={mentionables.length ? "combobox" : undefined}
        aria-expanded={mentionables.length ? open : undefined}
        aria-controls={open ? "mention-options" : undefined}
        aria-activedescendant={open ? `mention-${options[active]?.membershipId}` : undefined}
        aria-autocomplete={mentionables.length ? "list" : undefined}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insert(options[active]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-label="Novo comentário"
      />
      {open ? (
        <ul
          id="mention-options"
          role="listbox"
          aria-label="Mencionar"
          className="absolute top-full left-0 z-20 mt-1 w-64 max-w-full overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {options.map((m, i) => (
            <li
              key={m.membershipId}
              id={`mention-${m.membershipId}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(m);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                i === active ? "bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <Avatar name={m.name} src={m.image} size="xs" />
              <span className="truncate">{m.name}</span>
              {i === active ? <AtSign className="ml-auto size-3.5 text-fg-subtle" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
