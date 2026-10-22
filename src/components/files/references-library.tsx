"use client";

import { ExternalLink, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { relativeFromNow } from "@/lib/format";
import { REFERENCE_KIND_LABEL, referenceKindOf } from "@/lib/validators/files";
import { deleteReferenceAction, saveReferenceAction } from "@/server/actions/references";
import type { ReferenceRow } from "@/server/services/references";

type Option = { id: string; name: string };

export function ReferenceFormDialog({
  trigger,
  clients,
  reference,
}: {
  trigger: React.ReactNode;
  clients: Option[];
  reference?: ReferenceRow;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(reference?.url ?? "");
  const save = useOrgAction(saveReferenceAction, {
    success: reference ? "Referência atualizada" : "Referência salva",
    onSuccess: () => {
      setOpen(false);
      if (!reference) setUrl("");
    },
  });
  const fe = save.fieldErrors;
  const kind = /^https:\/\//i.test(url) ? referenceKindOf(url) : null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save.run({
              id: reference?.id ?? null,
              url,
              title: String(f.get("title") ?? ""),
              note: String(f.get("note") ?? ""),
              clientId: String(f.get("clientId") ?? ""),
              tags: String(f.get("tags") ?? "")
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{reference ? "Editar referência" : "Nova referência"}</DialogTitle>
            <DialogDescription>
              Salve links de inspiração (YouTube, Instagram, Pinterest, TikTok, Behance ou qualquer página). Só o
              endereço é guardado.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field
              label="Link"
              htmlFor="ref-url"
              required
              error={fe.url?.[0]}
              hint={kind ? `Origem: ${REFERENCE_KIND_LABEL[kind]}` : undefined}
            >
              <Input
                id="ref-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                autoFocus
              />
            </Field>
            <Field
              label="Título"
              htmlFor="ref-title"
              hint="Opcional — sem título, usamos o endereço."
              error={fe.title?.[0]}
            >
              <Input id="ref-title" name="title" defaultValue={reference?.title} />
            </Field>
            <Field label="Cliente" htmlFor="ref-client" hint="Deixe em branco para uma referência da agência.">
              <NativeSelect id="ref-client" name="clientId" defaultValue={reference?.clientId ?? ""}>
                <option value="">Agência (todos os clientes)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Etiquetas" htmlFor="ref-tags" hint="Separe por vírgula. Ex.: reels, tipografia, natal">
              <Input id="ref-tags" name="tags" defaultValue={reference?.tags.join(", ")} />
            </Field>
            <Field label="Observação" htmlFor="ref-note" error={fe.note?.[0]}>
              <Textarea id="ref-note" name="note" rows={3} defaultValue={reference?.note ?? ""} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={save.pending}>
              {reference ? "Salvar" : "Salvar referência"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReferencesGrid({
  rows,
  clients,
  canWrite,
  filtered,
}: {
  rows: ReferenceRow[];
  clients: Option[];
  canWrite: boolean;
  filtered: boolean;
}) {
  const remove = useOrgAction(deleteReferenceAction, { success: "Referência excluída" });
  if (!rows.length) {
    return (
      <EmptyState
        icon={Link2}
        title={filtered ? "Nenhuma referência encontrada" : "Nenhuma referência salva"}
        description={
          filtered
            ? "Ajuste a busca ou os filtros."
            : "Guarde aqui os links que inspiram a equipe — vídeos, posts, pins e portfólios."
        }
        action={
          canWrite && !filtered ? (
            <ReferenceFormDialog
              clients={clients}
              trigger={
                <Button variant="primary">
                  <Plus /> Nova referência
                </Button>
              }
            />
          ) : null
        }
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" data-testid="references">
      {rows.map((r) => (
        <li
          key={r.id}
          className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
          data-reference-id={r.id}
        >
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative flex aspect-video items-center justify-center bg-surface-2"
          >
            <ReferenceThumb url={r.url} thumbnail={r.thumbnail} />
            <Badge className="absolute top-2 left-2 bg-surface/90">{REFERENCE_KIND_LABEL[r.kind]}</Badge>
          </a>
          <div className="flex flex-1 flex-col gap-1.5 p-3">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="line-clamp-2 text-sm font-medium hover:underline"
            >
              {r.title}
              <ExternalLink className="ml-1 inline size-3 text-fg-subtle" aria-label="(abre em nova aba)" />
            </a>
            {r.note ? <p className="line-clamp-3 text-xs text-fg-muted">{r.note}</p> : null}
            {r.tags.length ? (
              <p className="flex flex-wrap gap-1">
                {r.tags.map((t) => (
                  <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">
                    #{t}
                  </span>
                ))}
              </p>
            ) : null}
            <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-fg-subtle">
              <span className="truncate">
                {r.clientName ?? "Agência"} · {relativeFromNow(r.createdAt)}
                {r.createdByName ? ` · ${r.createdByName}` : ""}
              </span>
              {canWrite ? (
                <span className="flex shrink-0 items-center">
                  <ReferenceFormDialog
                    reference={r}
                    clients={clients}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${r.title}`} title="Editar">
                        <Pencil />
                      </Button>
                    }
                  />
                  <ConfirmDialog
                    title="Excluir esta referência?"
                    description={`“${r.title}” sai da biblioteca. O link original não é afetado.`}
                    confirmLabel="Excluir"
                    onConfirm={() => remove.run({ id: r.id })}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${r.title}`} title="Excluir">
                        <Trash2 />
                      </Button>
                    }
                  />
                </span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Miniatura do YouTube; sem miniatura (ou se ela não carregar), mostra o domínio do link. */
function ReferenceThumb({ url, thumbnail }: { url: string; thumbnail: string | null }) {
  const [failed, setFailed] = useState(false);
  if (thumbnail && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- miniatura pública do YouTube
      <img
        src={thumbnail}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    );
  }
  return (
    <span className="flex w-full flex-col items-center gap-1 px-4 text-fg-subtle">
      <Link2 className="size-6" aria-hidden="true" />
      <span className="max-w-full truncate text-xs">{hostOf(url)}</span>
    </span>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
