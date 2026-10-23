"use client";

import { PackageOpen, Upload } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { formatBytes } from "@/lib/format";

type ImportResponse = {
  ok: boolean;
  error?: string;
  clientId?: string;
  name?: string;
  files?: number;
  projects?: number;
  tasks?: number;
  portal?: "published" | "draft" | "none";
};

/**
 * Importa um pacote de cliente (.zip com manifest.json): cria o cliente com
 * marca, biblioteca, projetos, demandas e portal de uma vez. Ao terminar, abre
 * o cliente criado. Erros do servidor aparecem no próprio campo.
 */
export function ImportPackageDialog({
  trigger,
  categories,
  maxBytes,
}: {
  trigger: React.ReactNode;
  categories?: { id: string; name: string }[];
  maxBytes: number;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Sugestão inicial: a categoria de clientes ativos, quando a agência tem uma (o manifesto também pode indicar).
  const [categoryId, setCategoryId] = useState(
    () => categories?.find((c) => /ativo/i.test(c.name) && !/inativ|^ex[- ]/i.test(c.name))?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function submit() {
    if (!file) {
      setError("Escolha o arquivo .zip do pacote.");
      return;
    }
    if (file.size > maxBytes) {
      setError(`O pacote tem ${formatBytes(file.size)}; o limite é ${formatBytes(maxBytes)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("orgSlug", orgSlug);
      if (categoryId) form.set("categoryId", categoryId);
      form.append("file", file, file.name);
      const res = await fetch("/api/clients/import", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as ImportResponse;
      if (!res.ok || !data.ok || !data.clientId) {
        setError(data.error ?? "Não foi possível importar o pacote.");
        return;
      }
      toast.success(
        `Cliente ${data.name} importado: ${data.files} arquivos, ${data.projects} projetos e ${data.tasks} demandas` +
          (data.portal === "published" ? "; portal publicado." : "."),
      );
      setOpen(false);
      reset();
      router.push(`/w/${orgSlug}/clients/${data.clientId}`);
      router.refresh();
    } catch {
      setError("Falha de conexão ao enviar o pacote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar pacote de cliente</DialogTitle>
          <DialogDescription>
            Um arquivo .zip com <code>manifest.json</code>, logotipos, materiais, projetos com demandas e a
            personalização do portal. Tudo é criado de uma vez; se algo falhar, nada fica gravado.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <Field
            label="Arquivo do pacote (.zip)"
            htmlFor="imp-file"
            hint={`Até ${formatBytes(maxBytes)}. O formato está em docs/PACOTE-DE-CLIENTE.md.`}
            error={error ?? undefined}
          >
            <input
              ref={input}
              id="imp-file"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <div className="flex min-w-0 items-center gap-2">
              <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
                <Upload /> Escolher arquivo
              </Button>
              <span className="truncate text-sm text-fg-muted">
                {file ? `${file.name} · ${formatBytes(file.size)}` : "Nenhum arquivo escolhido"}
              </span>
            </div>
          </Field>
          {categories?.length ? (
            <Field label="Categoria do cliente" htmlFor="imp-cat" hint="Opcional; sem escolha, vale a indicada no pacote">
              <NativeSelect id="imp-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" loading={busy} onClick={() => void submit()}>
            <PackageOpen /> Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
