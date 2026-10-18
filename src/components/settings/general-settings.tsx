"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import {
  updateGeneralSettingsAction,
  updatePortalSettingsAction,
  updateTimeSettingsAction,
  updateUploadSettingsAction,
} from "@/server/actions/settings";

type Props = {
  org: { name: string; logoUrl: string | null; slug: string };
  uploads: { maxBytes: number; allowedTypes: string[] };
  portal: { showInvoices: boolean; showProjectProgress: boolean; allowRequestCreation: boolean };
  time: { trackingEnabled: boolean };
  maxServerMb: number;
};

const TYPE_LABEL: Record<string, string> = {
  "image/": "Imagens",
  "video/": "Vídeos",
  "audio/": "Áudios",
  "application/pdf": "PDF",
  "application/zip": "ZIP",
  "application/postscript": "Illustrator / EPS",
  "application/vnd.openxmlformats-officedocument.": "Office (docx, xlsx, pptx)",
  "application/vnd.ms-": "Office antigo",
  "application/msword": "Word (doc)",
  "text/plain": "Texto",
  "text/csv": "CSV",
  "font/": "Fontes",
};

export function GeneralSettings({ org, uploads, portal, time, maxServerMb }: Props) {
  const [name, setName] = useState(org.name);
  const [logoUrl, setLogoUrl] = useState(org.logoUrl ?? "");
  const [maxMb, setMaxMb] = useState(String(Math.round(uploads.maxBytes / 1024 / 1024)));
  const [types, setTypes] = useState(uploads.allowedTypes);
  const [newType, setNewType] = useState("");
  const [portalState, setPortal] = useState(portal);
  const [tracking, setTracking] = useState(time.trackingEnabled);

  const general = useOrgAction(updateGeneralSettingsAction, { success: "Dados atualizados" });
  const upload = useOrgAction(updateUploadSettingsAction, { success: "Limites de arquivos atualizados" });
  const portalAction = useOrgAction(updatePortalSettingsAction, { success: "Área do cliente atualizada" });
  const timeAction = useOrgAction(updateTimeSettingsAction, { success: "Registro de tempo atualizado" });

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Organização</CardTitle>
            <CardDescription>Endereço: /w/{org.slug}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              general.run({ name, logoUrl });
            }}
          >
            <Field label="Nome da agência" htmlFor="s-name" error={general.fieldErrors.name}>
              <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label="URL do logotipo"
              htmlFor="s-logo"
              hint="Imagem quadrada, exibida no menu e na área do cliente."
              error={general.fieldErrors.logoUrl}
            >
              <Input id="s-logo" value={logoUrl} placeholder="https://" onChange={(e) => setLogoUrl(e.target.value)} />
            </Field>
            <div>
              <Button type="submit" variant="primary" loading={general.pending}>
                Salvar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Arquivos</CardTitle>
            <CardDescription>
              Validados no servidor a cada envio. Limite máximo do servidor: {maxServerMb} MB.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              upload.run({ maxMb: Number(maxMb), allowedTypes: types });
            }}
          >
            <Field label="Tamanho máximo por arquivo (MB)" htmlFor="s-max" error={upload.fieldErrors.maxMb}>
              <Input
                id="s-max"
                type="number"
                min={1}
                max={maxServerMb}
                value={maxMb}
                onChange={(e) => setMaxMb(e.target.value)}
                className="w-40"
              />
            </Field>
            <Field label="Tipos permitidos" error={upload.fieldErrors.allowedTypes}>
              <div className="flex flex-wrap gap-1.5">
                {types.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs"
                  >
                    {TYPE_LABEL[t] ?? t}
                    <button
                      type="button"
                      aria-label={`Remover ${t}`}
                      onClick={() => setTypes(types.filter((x) => x !== t))}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder="Tipo MIME ou prefixo (ex.: image/ ou application/pdf)"
                  className="h-8"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!newType.trim() || types.includes(newType.trim())}
                  onClick={() => {
                    setTypes([...types, newType.trim()]);
                    setNewType("");
                  }}
                >
                  <Plus /> Adicionar
                </Button>
              </div>
            </Field>
            <div>
              <Button type="submit" variant="primary" loading={upload.pending}>
                Salvar limites
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Área do cliente</CardTitle>
            <CardDescription>O que os usuários dos seus clientes podem ver e fazer.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {(
            [
              ["allowRequestCreation", "Criar solicitações", "Clientes abrem demandas pelos modelos de briefing."],
              [
                "showProjectProgress",
                "Ver andamento dos projetos",
                "Status, etapas e percentual concluído (sem tarefas internas).",
              ],
              ["showInvoices", "Ver faturas", "Faturas do próprio cliente. Custos internos nunca são exibidos."],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-fg-muted">{hint}</span>
              </span>
              <Switch
                checked={portalState[key]}
                onCheckedChange={(v) => {
                  const next = { ...portalState, [key]: v };
                  setPortal(next);
                  portalAction.run(next);
                }}
                aria-label={label}
              />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Registro de tempo</CardTitle>
            <CardDescription>Permite cronometrar tarefas e calcular o custo das horas nos projetos.</CardDescription>
          </div>
          <Switch
            checked={tracking}
            onCheckedChange={(v) => {
              setTracking(v);
              timeAction.run({ trackingEnabled: v });
            }}
            aria-label="Registro de tempo"
          />
        </CardHeader>
      </Card>
    </div>
  );
}
