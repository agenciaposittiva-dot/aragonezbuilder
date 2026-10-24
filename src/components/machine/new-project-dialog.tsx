"use client";

import { WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { useOrgAction } from "@/hooks/use-action";
import { createMachineProjectAction } from "@/server/actions/content-machine";

/** Etapa 1 da Máquina: escolher a marca (cliente). Abre o assistente já no assunto. */
export function NewMachineProjectDialog({
  clients,
  trendId,
  defaultTitle,
  trigger,
}: {
  clients: { id: string; name: string }[];
  trendId?: string;
  defaultTitle?: string;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [title, setTitle] = useState(defaultTitle ?? "");
  const create = useOrgAction(createMachineProjectAction, {
    onSuccess: (d) => router.push(`/w/${orgSlug}/maquina/${d.id}`),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo conteúdo na Máquina</DialogTitle>
          <DialogDescription>
            Escolha a marca: o perfil, a identidade visual e os conteúdos dela guiam todas as etapas.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (clientId) void create.run({ clientId, title: title.trim() || undefined, trendId });
          }}
        >
          <DialogBody className="grid gap-4">
            {clients.length ? (
              <Field label="Cliente (marca)" htmlFor="machine-client" required error={create.fieldErrors.clientId}>
                <NativeSelect id="machine-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <p className="text-sm text-fg-muted">Cadastre um cliente antes de criar conteúdos na Máquina.</p>
            )}
            <Field label="Nome do projeto" htmlFor="machine-title" hint="Opcional: dá para mudar depois.">
              <Input
                id="machine-title"
                value={title}
                maxLength={160}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Carrossel sobre métodos de preparo"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" variant="primary" loading={create.pending} disabled={!clientId}>
              <WandSparkles /> Começar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
