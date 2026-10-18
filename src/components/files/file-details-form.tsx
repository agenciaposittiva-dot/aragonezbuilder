"use client";

import { Share2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import {
  FILE_CATEGORIES,
  FILE_CATEGORY_LABEL,
  FILE_STATUS_LABEL,
  FILE_STATUSES,
  type FileCategory,
  type FileStatus,
} from "@/lib/validators/files";
import { deleteFileAction, setFileSharedAction, updateFileAction } from "@/server/actions/files";

type FileData = {
  id: string;
  name: string;
  description: string | null;
  category: FileCategory;
  tags: string[];
  status: FileStatus;
  folderId: string | null;
  clientId: string | null;
  sharedWithClient: boolean;
};

export function FileDetailsForm({
  file,
  folders,
  canWrite,
  canShare,
  canDelete,
}: {
  file: FileData;
  folders: { id: string; name: string }[];
  canWrite: boolean;
  canShare: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [shared, setShared] = useState(file.sharedWithClient);
  const save = useOrgAction(updateFileAction, { success: "Arquivo atualizado" });
  const share = useOrgAction(setFileSharedAction, {
    success: "Compartilhamento atualizado",
    onError: () => setShared((v) => !v),
  });
  const remove = useOrgAction(deleteFileAction, {
    success: "Arquivo excluído",
    onSuccess: () => router.replace(`/w/${orgSlug}/files`),
  });

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.run({
            id: file.id,
            name: String(f.get("name") ?? ""),
            description: String(f.get("description") ?? ""),
            category: String(f.get("category")) as FileCategory,
            status: String(f.get("status")) as FileStatus,
            folderId: String(f.get("folderId") ?? ""),
            tags: String(f.get("tags") ?? "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          });
        }}
      >
        <Field label="Nome" htmlFor="f-name" error={save.fieldErrors.name}>
          <Input id="f-name" name="name" defaultValue={file.name} disabled={!canWrite} required />
        </Field>
        <Field label="Descrição" htmlFor="f-desc">
          <Textarea
            id="f-desc"
            name="description"
            rows={2}
            defaultValue={file.description ?? ""}
            disabled={!canWrite}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Field label="Categoria" htmlFor="f-cat">
            <NativeSelect id="f-cat" name="category" defaultValue={file.category} disabled={!canWrite}>
              {FILE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {FILE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Status" htmlFor="f-status" hint="Aprovações atualizam o status automaticamente.">
            <NativeSelect id="f-status" name="status" defaultValue={file.status} disabled={!canWrite}>
              {FILE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {FILE_STATUS_LABEL[st]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Pasta" htmlFor="f-folder">
          <NativeSelect id="f-folder" name="folderId" defaultValue={file.folderId ?? ""} disabled={!canWrite}>
            <option value="">Sem pasta</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Etiquetas" htmlFor="f-tags" hint="Separe por vírgula.">
          <Input id="f-tags" name="tags" defaultValue={file.tags.join(", ")} disabled={!canWrite} />
        </Field>
        {canWrite ? (
          <Button type="submit" variant="secondary" loading={save.pending} className="justify-self-start">
            Salvar alterações
          </Button>
        ) : null}
      </form>

      {canShare ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Share2 className="size-4 text-fg-subtle" /> Compartilhar com o cliente
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {file.clientId
                ? "O cliente verá este arquivo na área dele."
                : "Associe o arquivo a um cliente para compartilhar."}
            </p>
          </div>
          <Switch
            checked={shared}
            disabled={!file.clientId || share.pending}
            onCheckedChange={(v) => {
              setShared(v);
              share.run({ fileId: file.id, shared: v });
            }}
            aria-label="Compartilhar com o cliente"
          />
        </div>
      ) : null}

      {canDelete ? (
        <ConfirmDialog
          title="Excluir arquivo?"
          description="O arquivo sai da biblioteca e aprovações pendentes são canceladas. As versões ficam preservadas no histórico."
          confirmLabel="Excluir"
          onConfirm={() => remove.run({ fileId: file.id })}
          trigger={
            <Button variant="danger-ghost" size="sm" className="justify-self-start">
              <Trash2 /> Excluir arquivo
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
