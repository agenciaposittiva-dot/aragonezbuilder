"use client";

import { ArrowDown, ArrowUp, FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useOrgAction } from "@/hooks/use-action";
import {
  BRIEFING_CATEGORIES,
  BRIEFING_CATEGORY_LABEL,
  BRIEFING_FIELD_TYPE_LABEL,
  BRIEFING_FIELD_TYPES,
  type BriefingCategory,
} from "@/lib/validators/briefings";
import { deleteTemplateAction, saveTemplateAction } from "@/server/actions/requests";
import type { BriefingField, BriefingFieldType } from "@/server/db/schema";

type Template = {
  id: string;
  name: string;
  category: BriefingCategory;
  description: string | null;
  isActive: boolean;
  fields: BriefingField[];
};

type Draft = Omit<Template, "id"> & { id?: string };
type DraftField = BriefingField & { optionsText?: string };

function toKey(label: string) {
  return (
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "campo"
  );
}

const EMPTY: Draft = { name: "", category: "other", description: "", isActive: true, fields: [] };

/** Modelos de briefing: campos configuráveis por categoria de serviço, sem código. */
export function TemplateBuilder({ templates }: { templates: Template[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<DraftField[]>([]);
  const save = useOrgAction(saveTemplateAction, { success: "Modelo salvo", onSuccess: () => setDraft(null) });
  const remove = useOrgAction(deleteTemplateAction, {
    success: (d) => (d.deactivated ? "Modelo em uso: foi desativado" : "Modelo excluído"),
    onSuccess: () => setDraft(null),
  });

  function open(t: Draft) {
    setDraft(t);
    setFields(t.fields.map((f) => ({ ...f, optionsText: f.options?.join("\n") ?? "" })));
  }

  function patchField(i: number, patch: Partial<DraftField>) {
    setFields((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }

  function move(i: number, dir: -1 | 1) {
    setFields((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function submit() {
    if (!draft) return;
    save.run({
      id: draft.id ?? null,
      name: draft.name,
      category: draft.category,
      description: draft.description,
      isActive: draft.isActive,
      fields: fields.map(({ optionsText, ...f }) => ({
        ...f,
        options: ["select", "multiselect"].includes(f.type)
          ? (optionsText ?? "")
              .split("\n")
              .map((o) => o.trim())
              .filter(Boolean)
          : undefined,
      })),
    });
  }

  const fe = save.fieldErrors;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          Cada modelo define as perguntas de um tipo de demanda. Clientes e atendimento escolhem o modelo ao abrir uma
          solicitação.
        </p>
        <Button variant="primary" onClick={() => open(EMPTY)}>
          <Plus /> Novo modelo
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Nenhum modelo de briefing"
            description="Crie modelos para design, vídeo, campanhas e outros serviços."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => open(t)}
                className="flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left shadow-xs transition-colors hover:border-border-strong"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  {t.isActive ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}
                </div>
                <span className="text-xs text-fg-muted">{t.description ?? BRIEFING_CATEGORY_LABEL[t.category]}</span>
                <span className="text-xs text-fg-subtle">
                  {BRIEFING_CATEGORY_LABEL[t.category]} · {t.fields.length} {t.fields.length === 1 ? "campo" : "campos"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <SheetContent width="lg" aria-describedby={undefined}>
          {draft ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border px-5 pt-5 pr-12 pb-4">
                <SheetTitle className="text-base font-semibold">
                  {draft.id ? "Editar modelo" : "Novo modelo de briefing"}
                </SheetTitle>
                <SheetDescription className="text-sm text-fg-muted">
                  Os campos padrão (título, objetivo, prazo, prioridade…) já fazem parte de toda solicitação.
                </SheetDescription>
              </div>
              <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-5 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nome" htmlFor="tb-name" required error={fe.name} className="sm:col-span-2">
                    <Input
                      id="tb-name"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Categoria" htmlFor="tb-cat">
                    <NativeSelect
                      id="tb-cat"
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value as BriefingCategory })}
                    >
                      {BRIEFING_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {BRIEFING_CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
                    Disponível para novas solicitações
                  </label>
                  <Field label="Descrição" htmlFor="tb-desc" className="sm:col-span-2">
                    <Input
                      id="tb-desc"
                      value={draft.description ?? ""}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Campos</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setFields((list) => [
                        ...list,
                        { key: `campo_${list.length + 1}`, label: "", type: "text", optionsText: "" },
                      ])
                    }
                  >
                    <Plus /> Adicionar campo
                  </Button>
                </div>
                {fe.fields ? <p className="mt-2 text-xs text-danger">{fe.fields[0]}</p> : null}
                <ol className="mt-3 grid gap-3">
                  {fields.map((f, i) => (
                    <li key={i} className="grid gap-3 rounded-lg border border-border p-3">
                      <div className="flex items-center gap-2">
                        <span className="tabular text-xs text-fg-subtle">{i + 1}.</span>
                        <Input
                          aria-label="Rótulo do campo"
                          placeholder="Pergunta (ex.: Redes sociais)"
                          value={f.label}
                          onChange={(e) => {
                            const label = e.target.value;
                            const auto = !f.key || f.key === toKey(f.label) || /^campo_\d+$/.test(f.key);
                            patchField(i, { label, ...(auto ? { key: toKey(label) } : {}) });
                          }}
                          className="h-8"
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Mover para cima"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Mover para baixo"
                          onClick={() => move(i, 1)}
                          disabled={i === fields.length - 1}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Remover campo"
                          onClick={() => setFields((list) => list.filter((_, j) => j !== i))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Tipo" htmlFor={`tb-type-${i}`}>
                          <NativeSelect
                            id={`tb-type-${i}`}
                            value={f.type}
                            onChange={(e) => patchField(i, { type: e.target.value as BriefingFieldType })}
                            className="h-8"
                          >
                            {BRIEFING_FIELD_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {BRIEFING_FIELD_TYPE_LABEL[t]}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                        <Field label="Chave" htmlFor={`tb-key-${i}`} error={fe[`fields.${i}.key`]}>
                          <Input
                            id={`tb-key-${i}`}
                            value={f.key}
                            onChange={(e) => patchField(i, { key: e.target.value })}
                            className="h-8 font-mono text-xs"
                          />
                        </Field>
                        <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
                          <Checkbox
                            checked={!!f.required}
                            onCheckedChange={(v) => patchField(i, { required: v === true })}
                          />
                          Obrigatório
                        </label>
                      </div>
                      {f.type === "select" || f.type === "multiselect" ? (
                        <Field label="Opções (uma por linha)" htmlFor={`tb-opt-${i}`} error={fe[`fields.${i}.options`]}>
                          <Textarea
                            id={`tb-opt-${i}`}
                            rows={3}
                            value={f.optionsText ?? ""}
                            onChange={(e) => patchField(i, { optionsText: e.target.value })}
                          />
                        </Field>
                      ) : null}
                      <Field label="Ajuda" htmlFor={`tb-help-${i}`}>
                        <Input
                          id={`tb-help-${i}`}
                          value={f.help ?? ""}
                          onChange={(e) => patchField(i, { help: e.target.value })}
                          className="h-8"
                          placeholder="Texto de apoio exibido abaixo do campo"
                        />
                      </Field>
                    </li>
                  ))}
                </ol>
                {!fields.length ? (
                  <p className="mt-3 text-sm text-fg-muted">Sem campos extras: o modelo usa só os campos padrão.</p>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
                {draft.id ? (
                  <ConfirmDialog
                    title="Excluir modelo?"
                    description="Se já houver solicitações com este modelo, ele será apenas desativado para preservar o histórico."
                    confirmLabel="Excluir"
                    onConfirm={() => remove.run({ id: draft.id! })}
                    trigger={
                      <Button variant="danger-ghost" size="sm">
                        <Trash2 /> Excluir
                      </Button>
                    }
                  />
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setDraft(null)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" loading={save.pending} onClick={submit}>
                    Salvar modelo
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
