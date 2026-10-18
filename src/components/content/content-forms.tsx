"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
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
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { CONTENT_FORMATS, CONTENT_STATUS, type ContentFormat, type ContentStatus } from "@/lib/content";
import { createCampaignAction, deleteContentAction, updateContentAction } from "@/server/actions/content";

export function NewCampaignDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ clientId: "", name: "", objective: "", startsOn: "", endsOn: "" });
  const action = useOrgAction(createCampaignAction, {
    success: "Campanha criada",
    onSuccess: () => {
      setOpen(false);
      setForm({ clientId: "", name: "", objective: "", startsOn: "", endsOn: "" });
    },
  });
  const err = action.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus /> Nova campanha
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(form);
          }}
        >
          <DialogHeader>
            <DialogTitle>Nova campanha</DialogTitle>
            <DialogDescription>Agrupa peças de conteúdo de um cliente com um objetivo e um período.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Cliente" htmlFor="cp-client" required error={err.clientId}>
              <NativeSelect
                id="cp-client"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              >
                <option value="">Escolha</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Nome" htmlFor="cp-name" required error={err.name}>
              <Input id="cp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Objetivo" htmlFor="cp-objective" className="sm:col-span-2">
              <Textarea
                id="cp-objective"
                rows={2}
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
              />
            </Field>
            <Field label="Início" htmlFor="cp-start">
              <Input
                id="cp-start"
                type="date"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
              />
            </Field>
            <Field label="Fim" htmlFor="cp-end" error={err.endsOn}>
              <Input
                id="cp-end"
                type="date"
                value={form.endsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={action.pending} disabled={!form.clientId}>
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ContentValues = {
  id: string;
  title: string;
  format: ContentFormat;
  status: ContentStatus;
  plannedDate: string | null;
  campaignId: string | null;
  concept: string | null;
  strategy: string | null;
  copy: string | null;
  caption: string | null;
  cta: string | null;
  script: string | null;
  visualDirection: string | null;
  imagePrompt: string | null;
  hashtags: string[];
  slides: { title: string; text: string }[];
};

/** Edição dos textos, status e data da peça (as artes são editadas no Estúdio). */
export function ContentEditor({
  value,
  campaigns,
  canWrite,
}: {
  value: ContentValues;
  campaigns: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [v, setV] = useState({ ...value, hashtags: value.hashtags.join(" ") });
  const save = useOrgAction(updateContentAction, { success: "Conteúdo salvo" });
  const remove = useOrgAction(deleteContentAction, {
    success: "Conteúdo excluído",
    onSuccess: () => router.push(`/w/${orgSlug}/content`),
  });
  const text = (k: keyof typeof v) => (v[k] as string | null) ?? "";
  const on =
    (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setV((cur) => ({ ...cur, [k]: e.target.value }));
  const err = save.fieldErrors;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run({
          id: v.id,
          title: v.title,
          status: v.status,
          format: v.format,
          plannedDate: v.plannedDate || null,
          campaignId: v.campaignId || null,
          concept: v.concept,
          strategy: v.strategy,
          copy: v.copy,
          caption: v.caption,
          cta: v.cta,
          script: v.script,
          visualDirection: v.visualDirection,
          imagePrompt: v.imagePrompt,
          hashtags: v.hashtags
            .split(/[\s,]+/)
            .filter(Boolean)
            .slice(0, 30),
          slides: v.slides,
        });
      }}
    >
      <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2">
        <Field label="Título" htmlFor="ct-title" required error={err.title} className="sm:col-span-2">
          <Input id="ct-title" value={v.title} onChange={on("title")} />
        </Field>
        <Field label="Status" htmlFor="ct-status">
          <NativeSelect id="ct-status" value={v.status} onChange={on("status")}>
            {Object.entries(CONTENT_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Data planejada" htmlFor="ct-date" error={err.plannedDate}>
          <Input id="ct-date" type="date" value={v.plannedDate ?? ""} onChange={on("plannedDate")} />
        </Field>
        <Field label="Formato" htmlFor="ct-format">
          <NativeSelect id="ct-format" value={v.format} onChange={on("format")}>
            {Object.entries(CONTENT_FORMATS).map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Campanha" htmlFor="ct-campaign">
          <NativeSelect id="ct-campaign" value={v.campaignId ?? ""} onChange={on("campaignId")}>
            <option value="">Sem campanha</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Conceito" htmlFor="ct-concept">
          <Textarea id="ct-concept" rows={3} value={text("concept")} onChange={on("concept")} />
        </Field>
        <Field label="Estratégia" htmlFor="ct-strategy">
          <Textarea id="ct-strategy" rows={3} value={text("strategy")} onChange={on("strategy")} />
        </Field>
        <Field label="Texto da arte (copy)" htmlFor="ct-copy">
          <Textarea id="ct-copy" rows={2} value={text("copy")} onChange={on("copy")} />
        </Field>
        <Field label="Chamada (CTA)" htmlFor="ct-cta">
          <Input id="ct-cta" value={text("cta")} onChange={on("cta")} />
        </Field>
        <Field label="Legenda" htmlFor="ct-caption" className="sm:col-span-2">
          <Textarea id="ct-caption" rows={4} value={text("caption")} onChange={on("caption")} />
        </Field>
        <Field label="Hashtags" htmlFor="ct-hashtags">
          <Input id="ct-hashtags" value={v.hashtags} onChange={on("hashtags")} />
        </Field>
        <Field label="Direção visual" htmlFor="ct-visual">
          <Input id="ct-visual" value={text("visualDirection")} onChange={on("visualDirection")} />
        </Field>
        <Field label="Roteiro" htmlFor="ct-script" className="sm:col-span-2">
          <Textarea id="ct-script" rows={3} value={text("script")} onChange={on("script")} />
        </Field>
        <Field label="Prompt da imagem" htmlFor="ct-imgprompt" className="sm:col-span-2">
          <Textarea id="ct-imgprompt" rows={2} value={text("imagePrompt")} onChange={on("imagePrompt")} />
        </Field>
        {v.slides.length ? (
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="text-sm font-medium">Páginas do carrossel</legend>
            {v.slides.map((sl, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <Input
                  aria-label={`Título da página ${i + 1}`}
                  value={sl.title}
                  onChange={(e) =>
                    setV((cur) => ({
                      ...cur,
                      slides: cur.slides.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    }))
                  }
                />
                <Input
                  aria-label={`Texto da página ${i + 1}`}
                  value={sl.text}
                  onChange={(e) =>
                    setV((cur) => ({
                      ...cur,
                      slides: cur.slides.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                    }))
                  }
                />
              </div>
            ))}
          </fieldset>
        ) : null}
      </fieldset>
      {canWrite ? (
        <div className="flex flex-wrap justify-between gap-2">
          <ConfirmDialog
            trigger={
              <Button type="button" variant="danger-ghost" size="sm">
                <Trash2 /> Excluir peça
              </Button>
            }
            title="Excluir esta peça?"
            description="As artes, arquivos, tarefa e briefing vinculados continuam existindo; só a peça e os vínculos saem."
            confirmLabel="Excluir"
            onConfirm={() => remove.run({ id: v.id })}
          />
          <Button type="submit" variant="primary" loading={save.pending}>
            Salvar
          </Button>
        </div>
      ) : null}
    </form>
  );
}
