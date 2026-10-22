"use client";

import { Check, ExternalLink, FileText, MessageSquareWarning } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { decideByApprovalLinkAction } from "@/server/actions/approval-link-public";
import type { ApprovalLinkView } from "@/server/services/approval-links";

type Item = Extract<ApprovalLinkView, { state: "active" }>["items"][number];

const NAME_KEY = "aprovar:nome";
const DATE = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Materiais do link: prévia, situação e, se pendente, aprovar ou pedir ajustes. */
export function ApprovalLinkItems({ token, items }: { token: string; items: Item[] }) {
  const [name, setName] = useState("");
  // O nome fica só neste aparelho, para não precisar digitar de novo (o servidor confere sempre).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- só disponível no navegador
      setName(window.localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      // Sem armazenamento: digita a cada visita.
    }
  }, []);
  const remember = (v: string) => {
    setName(v);
    try {
      window.localStorage.setItem(NAME_KEY, v);
    } catch {
      // ignora
    }
  };

  if (!items.length) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
        Os materiais deste link não estão mais disponíveis. Fale com a agência.
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      {items.some((i) => i.pending) ? (
        <Field
          label="Seu nome"
          htmlFor="approver-name"
          hint="Fica registrado junto com a sua decisão."
          className="max-w-sm"
        >
          <Input
            id="approver-name"
            value={name}
            maxLength={80}
            autoComplete="name"
            placeholder="Ex.: Paula Souza"
            onChange={(e) => remember(e.target.value)}
          />
        </Field>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2" data-testid="approval-link-items">
        {items.map((item) => (
          <ItemCard key={item.fileId} token={token} item={item} name={name} />
        ))}
      </ul>
    </div>
  );
}

function ItemCard({ token, item, name }: { token: string; item: Item; name: string }) {
  const [mode, setMode] = useState<"idle" | "changes">("idle");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const src = item.versionId ? `/api/aprovar/${token}/${item.versionId}` : null;
  const isImage = !!item.mimeType?.startsWith("image/");
  const preview = src && (isImage || item.hasThumb) ? (isImage ? src : `${src}?thumb=1`) : null;

  const decide = (decision: "approved" | "changes_requested") => {
    if (name.trim().length < 2) {
      toast.error("Informe seu nome antes de decidir.");
      document.getElementById("approver-name")?.focus();
      return;
    }
    start(async () => {
      const res = await decideByApprovalLinkAction(token, {
        fileId: item.fileId,
        decision,
        note: decision === "changes_requested" ? note : null,
        name: name.trim(),
      }).catch(() => ({ ok: false as const, error: "Falha de conexão. Tente de novo." }));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(decision === "approved" ? "Aprovado. Obrigado!" : "Pedido de ajustes enviado à agência.");
      setMode("idle");
      setNote("");
    });
  };

  return (
    <li
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xs"
      data-file-id={item.fileId}
    >
      <div className="flex aspect-[4/3] items-center justify-center bg-surface-2">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido por link assinado
          <img src={preview} alt={item.name} className="size-full object-contain" />
        ) : (
          <FileText className="size-10 text-fg-subtle" aria-hidden="true" />
        )}
      </div>
      <div className="grid gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{item.name}</p>
            <p className="text-xs text-fg-muted">Versão {item.versionNumber ?? "—"}</p>
          </div>
          {item.pending ? (
            <Badge tone="warning">Aguardando você</Badge>
          ) : item.last?.status === "approved" ? (
            <Badge tone="success">Aprovado</Badge>
          ) : item.last?.status === "changes_requested" ? (
            <Badge tone="danger">Ajustes pedidos</Badge>
          ) : (
            <Badge>Em preparação</Badge>
          )}
        </div>
        {item.pending?.message ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">{item.pending.message}</p>
        ) : null}
        {src ? (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
          >
            <ExternalLink className="size-3.5" /> Abrir em tamanho original
          </a>
        ) : null}
        {item.pending ? (
          mode === "changes" ? (
            <div className="grid gap-2">
              <Field label="O que precisa mudar?" htmlFor={`note-${item.fileId}`} required>
                <Textarea
                  id={`note-${item.fileId}`}
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex.: trocar a foto da capa e aumentar o preço"
                />
              </Field>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setMode("idle")} disabled={pending}>
                  Voltar
                </Button>
                <Button
                  variant="danger"
                  onClick={() => decide("changes_requested")}
                  loading={pending}
                  disabled={!note.trim()}
                >
                  Enviar pedido de ajustes
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => decide("approved")} loading={pending}>
                <Check /> Aprovar
              </Button>
              <Button variant="secondary" onClick={() => setMode("changes")} disabled={pending}>
                <MessageSquareWarning /> Pedir ajustes
              </Button>
            </div>
          )
        ) : item.last ? (
          <p className="text-xs text-fg-muted">
            {item.last.status === "approved" ? "Aprovado" : "Ajustes pedidos"}
            {item.last.by ? ` por ${item.last.by}` : ""}
            {item.last.decidedAt ? ` em ${DATE.format(item.last.decidedAt)}` : ""}.
            {item.last.note ? <span className="mt-1 block text-fg">“{item.last.note}”</span> : null}
          </p>
        ) : (
          <p className="text-xs text-fg-muted">A agência ainda vai enviar este material para aprovação.</p>
        )}
      </div>
    </li>
  );
}
