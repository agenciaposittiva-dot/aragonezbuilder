"use client";

import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/input";
import type { StepProps } from "../machine-wizard";

/** Etapa 1: a marca. Trocar de cliente só antes de gerar (as informações não se misturam). */
export function StepClient({ view, clientId, setClientId, clients, readOnly }: StepProps) {
  const { orgSlug } = useWorkspace();
  const locked = !!view.design;
  const changed = clientId !== view.project.clientId;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Field
          label="Cliente (marca)"
          htmlFor="machine-step-client"
          hint={
            locked
              ? "O conteúdo já foi gerado para esta marca. Para outra marca, crie um novo projeto."
              : "Trocar de cliente descarta a oportunidade e os ângulos sugeridos para a marca anterior."
          }
        >
          <NativeSelect
            id="machine-step-client"
            value={clientId}
            disabled={locked || readOnly}
            onChange={(e) => setClientId(e.target.value)}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="rounded-lg border border-border bg-surface-2/40 p-4 text-sm">
        <p className="font-medium">Perfil da marca usado pela Máquina</p>
        {changed ? (
          <p className="mt-1 text-fg-muted">O perfil do novo cliente será conferido assim que a troca for salva.</p>
        ) : view.brand.missing.length ? (
          <div className="mt-2 grid gap-2">
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Faltam: {view.brand.missing.join(", ")}.{" "}
                {view.brand.provisional
                  ? "As propostas saem marcadas como provisórias até o perfil ser completado."
                  : "Dá para seguir; completar o perfil deixa o conteúdo mais específico."}
              </span>
            </p>
            <Link
              href={`/w/${orgSlug}/clients/${view.brand.client.id}?tab=brand`}
              className="inline-flex items-center gap-1 text-accent-text hover:underline"
            >
              Completar perfil da marca <ExternalLink className="size-3" />
            </Link>
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-success">
            <CheckCircle2 className="size-4" /> Posicionamento, público, tom de voz e cores cadastrados.
          </p>
        )}
        <p className="mt-3 text-xs text-fg-subtle">
          O perfil só é enviado ao provedor de IA se a organização autorizar &quot;dados de clientes&quot; em
          Configurações → IA. Cores, fontes e logo são aplicadas sempre, sem sair da plataforma.
        </p>
      </div>
    </div>
  );
}
