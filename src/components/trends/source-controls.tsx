"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
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
import { useOrgAction } from "@/hooks/use-action";
import { TREND_LANGUAGES, TREND_NICHES, TREND_REGIONS } from "@/lib/trends";
import { deleteSourceAction, saveRssSourceAction, setSourceEnabledAction } from "@/server/actions/trends";

export function SourceEnabledSwitch({ id, enabled, name }: { id: string; enabled: boolean; name: string }) {
  const action = useOrgAction(setSourceEnabledAction, { success: enabled ? "Fonte desativada" : "Fonte ativada" });
  return (
    <Switch
      checked={enabled}
      disabled={action.pending}
      aria-label={`${enabled ? "Desativar" : "Ativar"} ${name}`}
      onCheckedChange={(v) => action.run({ id, enabled: !!v })}
    />
  );
}

export function DeleteSourceButton({ id, name }: { id: string; name: string }) {
  const action = useOrgAction(deleteSourceAction, { success: "Fonte removida" });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="danger-ghost" size="xs">
          <Trash2 /> Remover
        </Button>
      }
      title={`Remover “${name}”?`}
      description="As tendências coletadas deste feed também saem do Radar. Conteúdos já criados continuam existindo."
      confirmLabel="Remover"
      onConfirm={() => action.run({ id })}
    />
  );
}

export function AddRssSourceDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", niche: "", region: "BR", language: "pt" });
  const action = useOrgAction(saveRssSourceAction, {
    success: "Feed adicionado. Use “Testar agora” para a primeira coleta.",
    onSuccess: () => {
      setOpen(false);
      setForm({ name: "", url: "", niche: "", region: "BR", language: "pt" });
    },
  });
  const err = action.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus /> Adicionar feed RSS/Atom
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run({ ...form, niche: form.niche || null });
          }}
          className="contents"
        >
          <DialogHeader>
            <DialogTitle>Adicionar feed de notícias</DialogTitle>
            <DialogDescription>
              Use o endereço RSS ou Atom publicado pelo próprio veículo (normalmente em “RSS” no rodapé do site). Só
              lemos o que o feed oferece: título, resumo, link e data — sem números de audiência.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <Field label="Nome do veículo" htmlFor="rss-name" required error={err.name}>
              <Input id="rss-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Endereço do feed" htmlFor="rss-url" required error={err.url}>
              <Input
                id="rss-url"
                type="url"
                placeholder="https://exemplo.com.br/feed"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nicho" htmlFor="rss-niche">
                <NativeSelect
                  id="rss-niche"
                  value={form.niche}
                  onChange={(e) => setForm({ ...form, niche: e.target.value })}
                >
                  <option value="">Sem nicho</option>
                  {Object.entries(TREND_NICHES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Mercado" htmlFor="rss-region">
                <NativeSelect
                  id="rss-region"
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                >
                  {Object.entries(TREND_REGIONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Idioma" htmlFor="rss-language">
                <NativeSelect
                  id="rss-language"
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                >
                  {Object.entries(TREND_LANGUAGES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={action.pending}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
