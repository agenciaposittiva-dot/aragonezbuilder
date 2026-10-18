"use client";

import { Lock, MessageSquare, Trash2 } from "lucide-react";
import { useState } from "react";
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
  placeholder = "Escreva um comentário…",
}: {
  target: CommentTarget;
  comments: CommentItem[];
  allowInternal: boolean;
  defaultInternal?: boolean;
  placeholder?: string;
}) {
  const ws = useWorkspace();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(allowInternal && defaultInternal);
  const add = useOrgAction(addCommentAction, { onSuccess: () => setBody("") });
  const remove = useOrgAction(deleteCommentAction);
  const isAdmin = ws.permissions.includes("org.manage");

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
                    "mt-1 rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                    c.internal ? "border border-dashed border-warning/40 bg-warning-soft/40" : "bg-surface-2",
                  )}
                >
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.run({ target, body, internal });
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
              e.preventDefault();
              add.run({ target, body, internal });
            }
          }}
          aria-label="Novo comentário"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {allowInternal ? (
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
    </div>
  );
}
