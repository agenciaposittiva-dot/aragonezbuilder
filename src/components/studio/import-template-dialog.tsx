"use client";

import { ImageUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { AiPreference, AiSelection, PickerProvider } from "@/lib/ai-select";

/**
 * Importar JPG/PNG como modelo: a imagem vai para Arquivos e vira a camada
 * de fundo bloqueada de um template editável; com um modelo que lê imagens,
 * a IA reconstrói textos e blocos de cor em camadas (a original fica oculta).
 */
export function ImportTemplateDialog({
  trigger,
  clients,
  canManageTemplates,
  picker,
}: {
  trigger: React.ReactNode;
  clients: { id: string; name: string }[];
  canManageTemplates: boolean;
  picker: { providers: PickerProvider[]; preferences: AiPreference[] } | null;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [asTemplate, setAsTemplate] = useState(canManageTemplates);
  const [reconstruct, setReconstruct] = useState(false);
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costPrompt, setCostPrompt] = useState<string | null>(null);
  const vision = !!picker?.providers.some(
    (p) => p.ready && p.models.some((m) => m.caps.imageInput !== "no" && m.kind === "text"),
  );

  async function submit(confirmCost = false) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setCostPrompt(null);
    const form = new FormData();
    form.set("orgSlug", orgSlug);
    form.set("file", file);
    if (name.trim()) form.set("name", name.trim());
    if (clientId) form.set("clientId", clientId);
    form.set("asTemplate", String(asTemplate));
    form.set("reconstruct", String(reconstruct));
    form.set("selection", JSON.stringify(selection));
    if (confirmCost) form.set("confirmCost", "true");
    try {
      const res = await fetch("/api/studio/import-template", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        message?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok || !json.ok || !json.id) {
        if (json.code === "cost_confirmation") setCostPrompt(json.error ?? "Confirme o custo para continuar.");
        else setError(json.error ?? "Não foi possível importar a imagem.");
        return;
      }
      toast.success(json.message ?? "Template criado.");
      setOpen(false);
      router.push(`/w/${orgSlug}/studio/${json.id}`);
    } catch {
      setError("Falha de conexão. Nada foi criado; tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Importar JPG/PNG como modelo</DialogTitle>
          <DialogDescription>
            A imagem original fica em Arquivos e vira a camada de fundo (bloqueada) de um template editável.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <Field label="Imagem (JPG ou PNG)" htmlFor="it-file" required>
            <Input
              id="it-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.[a-z0-9]+$/i, ""));
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="it-name">
              <Input
                id="it-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                disabled={busy}
              />
            </Field>
            <Field label="Cliente" htmlFor="it-client" hint="O arquivo original fica nos Arquivos do cliente.">
              <NativeSelect
                id="it-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={busy}
              >
                <option value="">Agência (sem cliente)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {canManageTemplates ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={asTemplate}
                onCheckedChange={(v) => setAsTemplate(v === true)}
                aria-label="Salvar como template"
              />
              Salvar como template (aparece em Templates e no painel Modelos do editor)
            </label>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={reconstruct}
              onCheckedChange={(v) => setReconstruct(v === true)}
              disabled={busy || !picker}
              aria-label="Reconstruir camadas editáveis com IA"
            />
            <span>
              Reconstruir textos e blocos de cor em camadas editáveis com IA
              <span className="block text-xs text-fg-muted">
                {vision
                  ? "Usa um modelo com leitura de imagens. A original fica oculta e bloqueada, para comparar ou recuperar."
                  : "Nenhum modelo com leitura de imagens configurado: será criada só a camada de fundo."}
              </span>
            </span>
          </label>
          {reconstruct && picker ? (
            <AiModelPicker
              providers={picker.providers}
              preferences={picker.preferences}
              task="reference_analysis"
              module="editor"
              value={selection}
              onChange={setSelection}
              disabled={busy}
            />
          ) : null}
          {costPrompt ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg bg-warning-soft p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{costPrompt}</span>
              <Button size="sm" variant="primary" onClick={() => void submit(true)}>
                Confirmar e importar
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!file} loading={busy}>
            <ImageUp /> Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
