"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { DESIGN_PRESETS } from "@/lib/design-presets";
import { cn } from "@/lib/utils";
import { createDesignAction } from "@/server/actions/designs";

export function NewDesignDialog({
  trigger,
  clients,
  projects,
  templates,
  canManageTemplates,
  defaultTemplateId,
}: {
  trigger: React.ReactNode;
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string; clientName: string }[];
  templates: { id: string; name: string; width: number; height: number; thumbnail: string | null }[];
  canManageTemplates: boolean;
  defaultTemplateId?: string;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<string>(DESIGN_PRESETS[0].key);
  const [custom, setCustom] = useState({ width: 1080, height: 1080 });
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? "");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [isTemplate, setIsTemplate] = useState(false);
  const create = useOrgAction(createDesignAction, {
    onSuccess: (d) => {
      setOpen(false);
      router.push(`/w/${orgSlug}/studio/${d.id}`);
    },
  });
  const size = preset === "custom" ? custom : (DESIGN_PRESETS.find((p) => p.key === preset) ?? DESIGN_PRESETS[0]);
  const visibleProjects = clientId ? projects.filter((p) => p.clientId === clientId) : projects;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && defaultTemplateId) setTemplateId(defaultTemplateId);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            create.run({
              name: name || "Arte sem título",
              width: size.width,
              height: size.height,
              clientId,
              projectId,
              templateId,
              isTemplate,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Nova arte</DialogTitle>
            <DialogDescription>Comece do zero em um formato ou a partir de um template da agência.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Nome" htmlFor="d-name">
              <Input
                id="d-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Post lançamento panetone"
                autoFocus
              />
            </Field>
            {templates.length ? (
              <Field label="Template">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => setTemplateId("")}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-lg border text-xs text-fg-muted",
                      !templateId ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-border-strong",
                    )}
                  >
                    Em branco
                  </button>
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      title={t.name}
                      className={cn(
                        "relative overflow-hidden rounded-lg border bg-surface-2",
                        templateId === t.id
                          ? "border-accent ring-2 ring-accent/40"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      {t.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.thumbnail} alt="" className="aspect-square w-full object-contain" />
                      ) : (
                        <span className="flex aspect-square items-center justify-center text-[11px] text-fg-muted">
                          {t.name}
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                        {t.name}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
            ) : null}
            {!templateId ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Formato" htmlFor="d-preset" className="sm:col-span-2">
                  <NativeSelect id="d-preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
                    {DESIGN_PRESETS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label} — {p.width}×{p.height}
                      </option>
                    ))}
                    <option value="custom">Personalizado</option>
                  </NativeSelect>
                </Field>
                {preset === "custom" ? (
                  <>
                    <Field label="Largura (px)" htmlFor="d-w">
                      <Input
                        id="d-w"
                        type="number"
                        min={16}
                        max={10000}
                        value={custom.width}
                        onChange={(e) => setCustom({ ...custom, width: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Altura (px)" htmlFor="d-h">
                      <Input
                        id="d-h"
                        type="number"
                        min={16}
                        max={10000}
                        value={custom.height}
                        onChange={(e) => setCustom({ ...custom, height: Number(e.target.value) })}
                      />
                    </Field>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cliente" htmlFor="d-client" hint="Libera as cores, fontes e logos da marca no editor.">
                <NativeSelect
                  id="d-client"
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setProjectId("");
                  }}
                >
                  <option value="">Nenhum</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Projeto" htmlFor="d-project">
                <NativeSelect id="d-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Nenhum</option>
                  {visibleProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {clientId ? p.name : `${p.clientName} · ${p.name}`}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {canManageTemplates ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isTemplate} onCheckedChange={(v) => setIsTemplate(v === true)} />
                Salvar como template reutilizável
              </label>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={create.pending}>
              Criar e abrir editor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
