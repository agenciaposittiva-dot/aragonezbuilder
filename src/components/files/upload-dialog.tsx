"use client";

import { CheckCircle2, CloudUpload, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FILE_CATEGORIES, FILE_CATEGORY_LABEL } from "@/lib/validators/files";
import { FileIcon } from "./file-icon";
import { exportVersionToDriveAction } from "@/server/actions/google-drive";
import { useUpload, type UploadTarget } from "./use-upload";

type Option = { id: string; name: string };

/** Envio de arquivos com arrastar e soltar, vários de uma vez, com progresso. */
export function UploadDialog({
  trigger,
  target = {},
  clients,
  projects,
  folders,
  newVersionOf,
  maxBytes,
  allowCategory = true,
  onUploaded,
  drive,
}: {
  trigger: React.ReactNode;
  target?: UploadTarget;
  clients?: Option[];
  projects?: (Option & { clientId: string })[];
  folders?: Option[];
  /** Quando informado, envia uma NOVA VERSÃO deste arquivo. */
  newVersionOf?: { id: string; name: string };
  maxBytes?: number;
  allowCategory?: boolean;
  onUploaded?: () => void;
  /** Google Drive da pessoa: conectado e se é o destino preferido (cópia além da plataforma). */
  drive?: { connected: boolean; preferred: boolean };
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [clientId, setClientId] = useState(target.clientId ?? "");
  const [projectId, setProjectId] = useState(target.projectId ?? "");
  const [folderId, setFolderId] = useState(target.folderId ?? "");
  const [category, setCategory] = useState(target.category ?? "general");
  const [tags, setTags] = useState((target.tags ?? []).join(", "));
  const [note, setNote] = useState("");
  const [toDrive, setToDrive] = useState(!!drive?.connected && !!drive?.preferred);
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, add, remove, reset, upload, busy } = useUpload(orgSlug);
  const single = !!newVersionOf;

  function pick(list: FileList | File[] | null) {
    if (!list) return;
    const files = Array.from(list);
    const tooBig = maxBytes ? files.filter((f) => f.size > maxBytes) : [];
    if (tooBig.length)
      toast.error(`${tooBig.map((f) => f.name).join(", ")}: acima do limite de ${formatBytes(maxBytes!)}.`);
    const ok = files.filter((f) => !maxBytes || f.size <= maxBytes);
    if (single) {
      reset();
      add(ok.slice(0, 1));
    } else add(ok);
  }

  async function submit() {
    const res = await upload({
      ...target,
      fileId: newVersionOf?.id ?? null,
      clientId: clientId || target.clientId || null,
      projectId: projectId || target.projectId || null,
      folderId: folderId || target.folderId || null,
      category: allowCategory ? category : target.category,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      note: note || null,
    });
    if (res.done) {
      toast.success(single ? "Nova versão enviada" : `${res.done} arquivo(s) enviado(s)`);
      if (toDrive && drive?.connected && res.versions.length) {
        // Cópia no Google Drive da pessoa: só confirma com a resposta do Google, um a um.
        let sent = 0;
        let failure: string | null = null;
        for (const versionId of res.versions) {
          const r = await exportVersionToDriveAction(orgSlug, { versionId });
          if (!r.ok) {
            failure = r.error;
            break;
          }
          sent++;
        }
        if (failure) toast.error(`Google Drive: ${sent} de ${res.versions.length} enviado(s). ${failure}`);
        else toast.success(`${sent} arquivo(s) também salvo(s) no seu Google Drive.`);
      }
      router.refresh();
      onUploaded?.();
    }
    if (!res.failed) {
      setOpen(false);
      reset();
      setNote("");
    }
  }

  const visibleProjects = projects?.filter((p) => !clientId || p.clientId === clientId);
  const pending = items.filter((i) => i.status !== "done").length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && !busy) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{single ? `Nova versão de ${newVersionOf!.name}` : "Enviar arquivos"}</DialogTitle>
          <DialogDescription>
            {single
              ? "A nova versão substitui a atual. Aprovações pendentes da versão anterior deixam de valer."
              : "Arraste arquivos ou clique para escolher. O tipo real e o tamanho são verificados no servidor."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-10 text-center transition-colors hover:border-border-strong hover:bg-surface-2/50",
              dragging && "border-accent bg-accent-soft/40",
            )}
          >
            <CloudUpload className="size-8 text-fg-subtle" aria-hidden="true" />
            <p className="text-sm font-medium">
              {single ? "Escolha o arquivo da nova versão" : "Solte os arquivos aqui ou clique para escolher"}
            </p>
            {maxBytes ? <p className="text-xs text-fg-subtle">Até {formatBytes(maxBytes)} por arquivo</p> : null}
            <input
              ref={inputRef}
              type="file"
              multiple={!single}
              className="sr-only"
              onChange={(e) => pick(e.target.files)}
              aria-label="Escolher arquivos"
            />
          </div>

          {items.length ? (
            <ul className="grid gap-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <FileIcon mime={it.file.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{it.file.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width]",
                            it.status === "error" ? "bg-danger" : "bg-accent",
                          )}
                          style={{ width: `${it.status === "queued" ? 0 : it.progress}%` }}
                        />
                      </div>
                      <span className="tabular text-[11px] text-fg-subtle">{formatBytes(it.file.size)}</span>
                    </div>
                    {it.error ? <p className="mt-1 text-xs text-danger">{it.error}</p> : null}
                  </div>
                  {it.status === "done" ? (
                    <CheckCircle2 className="size-4 text-success" aria-label="Enviado" />
                  ) : it.status === "error" ? (
                    <XCircle className="size-4 text-danger" aria-label="Falhou" />
                  ) : null}
                  {it.status !== "uploading" && it.status !== "done" ? (
                    <button
                      type="button"
                      onClick={() => remove(it.id)}
                      className="text-fg-subtle hover:text-fg"
                      aria-label={`Remover ${it.file.name}`}
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {single ? (
            <Field label="Observação da versão" htmlFor="up-note">
              <Input
                id="up-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: ajustes de cor pedidos pelo cliente"
              />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {clients && !target.clientId ? (
                <Field label="Cliente" htmlFor="up-client">
                  <NativeSelect
                    id="up-client"
                    value={clientId}
                    onChange={(e) => {
                      setClientId(e.target.value);
                      setProjectId("");
                    }}
                  >
                    <option value="">Sem cliente (interno)</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              {visibleProjects && !target.projectId ? (
                <Field label="Projeto" htmlFor="up-project">
                  <NativeSelect id="up-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">Sem projeto</option>
                    {visibleProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              {folders?.length && !target.folderId ? (
                <Field label="Pasta" htmlFor="up-folder">
                  <NativeSelect id="up-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                    <option value="">Raiz</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              {drive?.connected ? (
                <Field label="Destino" htmlFor="up-destination">
                  <NativeSelect
                    id="up-destination"
                    value={toDrive ? "drive" : "platform"}
                    onChange={(e) => setToDrive(e.target.value === "drive")}
                  >
                    <option value="platform">Armazenamento da plataforma</option>
                    <option value="drive">Plataforma + cópia no meu Google Drive</option>
                  </NativeSelect>
                </Field>
              ) : null}
              {allowCategory ? (
                <Field label="Categoria" htmlFor="up-category">
                  <NativeSelect id="up-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {FILE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {FILE_CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              {allowCategory ? (
                <Field label="Etiquetas" htmlFor="up-tags" hint="Separe por vírgula." className="sm:col-span-2">
                  <Input
                    id="up-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="natal, feed, story"
                  />
                </Field>
              ) : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
            {items.some((i) => i.status === "done") ? "Fechar" : "Cancelar"}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!pending}>
            {single ? "Enviar versão" : pending > 1 ? `Enviar ${pending} arquivos` : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
