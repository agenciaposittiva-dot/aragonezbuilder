"use client";

import { FileText, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from "@/lib/autosave/local-draft";
import { cn } from "@/lib/utils";
import { BRIEFING_CATEGORIES, BRIEFING_CATEGORY_LABEL, type BriefingCategory } from "@/lib/validators/briefings";
import { createRequestAction } from "@/server/actions/requests";
import type { BriefingField } from "@/server/db/schema";
import { BriefingFieldInput } from "./briefing-field-input";

export type TemplateOption = {
  id: string;
  name: string;
  category: BriefingCategory;
  description: string | null;
  fields: BriefingField[];
};

/** O que foi preenchido e ainda não enviado, guardado neste aparelho. */
type FormDraft = {
  fields: Record<string, string>;
  clientId: string;
  templateId: string | null;
  category: BriefingCategory;
  answers: Record<string, unknown>;
};

/**
 * Formulário de nova solicitação com briefing dinâmico (campos do modelo escolhido).
 * Reutilizável na área da agência e na área do cliente.
 */
export function RequestForm({
  clients,
  fixedClientId,
  templates,
  detailBase,
  allowDraft = true,
}: {
  clients?: { id: string; name: string }[];
  fixedClientId?: string;
  templates: TemplateOption[];
  /** Base da URL de detalhe, ex.: /w/agencia/requests */
  detailBase: string;
  allowDraft?: boolean;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(fixedClientId ?? (clients?.length === 1 ? clients[0]!.id : ""));
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [category, setCategory] = useState<BriefingCategory>("other");
  const template = templates.find((t) => t.id === templateId) ?? null;
  const formRef = useRef<HTMLFormElement>(null);
  const draftKey = `request:new:${detailBase}`;
  const draftReady = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recoveredAt, setRecoveredAt] = useState<number | null>(null);
  const create = useOrgAction(createRequestAction, {
    success: (d) => `Solicitação #${d.number} criada`,
    onSuccess: (d) => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      void clearLocalDraft(draftKey);
      router.push(`${detailBase}/${d.id}`);
    },
  });
  const fe = create.fieldErrors;

  /** Guarda o preenchimento no aparelho (aba fechada, queda de conexão) até a solicitação ser criada. */
  function persistDraft() {
    if (!draftReady.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const fields: Record<string, string> = {};
      for (const [k, v] of new FormData(form)) if (typeof v === "string" && v) fields[k] = v;
      const filled = Object.keys(fields).some((k) => k !== "priority") || Object.keys(answers).length > 0;
      if (!filled) return void clearLocalDraft(draftKey);
      const data: FormDraft = { fields, clientId, templateId, category, answers };
      void saveLocalDraft(draftKey, { data, baseRevision: null, savedAt: Date.now() });
    }, 500);
  }

  useEffect(() => {
    let alive = true;
    void loadLocalDraft<FormDraft>(draftKey).then((d) => {
      if (!alive) return;
      draftReady.current = true;
      const form = formRef.current;
      if (!d || !form) return;
      for (const [k, v] of Object.entries(d.data.fields)) {
        const el = form.elements.namedItem(k);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          el.value = v;
        }
      }
      if (!fixedClientId && d.data.clientId) setClientId(d.data.clientId);
      setTemplateId(d.data.templateId);
      setCategory(d.data.category);
      setAnswers(d.data.answers);
      setRecoveredAt(d.savedAt);
    });
    return () => {
      alive = false;
    };
  }, [draftKey, fixedClientId]);

  // Escolhas controladas pelo React (cliente, modelo, respostas do briefing) também entram no rascunho.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => persistDraft(), [clientId, templateId, category, answers]);

  function discardDraft() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    void clearLocalDraft(draftKey);
    formRef.current?.reset();
    setTemplateId(null);
    setCategory("other");
    setAnswers({});
    setRecoveredAt(null);
  }

  function submit(form: HTMLFormElement, draft: boolean) {
    const f = new FormData(form);
    const pieces = String(f.get("piecesCount") ?? "");
    create.run({
      clientId,
      templateId,
      title: String(f.get("title") ?? ""),
      category: template?.category ?? category,
      objective: String(f.get("objective") ?? ""),
      description: String(f.get("description") ?? ""),
      audience: String(f.get("audience") ?? ""),
      channel: String(f.get("channel") ?? ""),
      format: String(f.get("format") ?? ""),
      piecesCount: pieces ? Number(pieces) : null,
      desiredDueDate: String(f.get("desiredDueDate") ?? ""),
      priority: String(f.get("priority") ?? "medium") as "medium",
      references: String(f.get("references") ?? ""),
      copyText: String(f.get("copyText") ?? ""),
      briefing: answers,
      draft,
    });
  }

  return (
    <form
      ref={formRef}
      className="grid gap-6"
      noValidate
      onInput={persistDraft}
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget, false);
      }}
    >
      {recoveredAt ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            Recuperamos o que você tinha preenchido e ainda não enviou (guardado neste aparelho às{" "}
            {new Date(recoveredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}).
          </span>
          <Button type="button" size="xs" variant="secondary" className="shrink-0" onClick={discardDraft}>
            Descartar rascunho
          </Button>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tipo de demanda</CardTitle>
            <CardDescription>
              Escolha um modelo de briefing para responder só ao que importa para esse tipo de peça.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {clients && !fixedClientId ? (
            <Field label="Cliente" htmlFor="rq-client" required error={fe.clientId}>
              <NativeSelect
                id="rq-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                aria-invalid={!!fe.clientId}
              >
                <option value="">Selecione…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Modelo de briefing">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={templateId === t.id}
                onClick={() => {
                  setTemplateId(templateId === t.id ? null : t.id);
                  setAnswers({});
                }}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  templateId === t.id ? "border-accent bg-accent-soft/40" : "border-border hover:border-border-strong",
                )}
              >
                <FileText
                  className={cn("mt-0.5 size-4 shrink-0", templateId === t.id ? "text-accent-text" : "text-fg-subtle")}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-fg-muted">
                    {t.description ?? BRIEFING_CATEGORY_LABEL[t.category]}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {!template ? (
            <Field label="Categoria" htmlFor="rq-category">
              <NativeSelect
                id="rq-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BriefingCategory)}
              >
                {BRIEFING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BRIEFING_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Briefing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Título" htmlFor="rq-title" required error={fe.title} className="sm:col-span-2">
            <Input
              id="rq-title"
              name="title"
              placeholder="Ex.: Posts da semana do Dia das Crianças"
              aria-invalid={!!fe.title}
            />
          </Field>
          <Field
            label="Objetivo"
            htmlFor="rq-objective"
            className="sm:col-span-2"
            hint="O que esta entrega precisa alcançar?"
          >
            <Textarea id="rq-objective" name="objective" rows={2} />
          </Field>
          <Field label="Descrição" htmlFor="rq-description" className="sm:col-span-2">
            <Textarea
              id="rq-description"
              name="description"
              rows={4}
              placeholder="Contexto, mensagem principal, oferta, detalhes importantes…"
            />
          </Field>
          <Field label="Público-alvo" htmlFor="rq-audience">
            <Input id="rq-audience" name="audience" />
          </Field>
          <Field label="Canal" htmlFor="rq-channel">
            <Input id="rq-channel" name="channel" placeholder="Instagram, site, e-mail, loja física…" />
          </Field>
          <Field label="Formato" htmlFor="rq-format">
            <Input id="rq-format" name="format" placeholder="Feed 4:5, story, banner 1200×628…" />
          </Field>
          <Field label="Quantidade de peças" htmlFor="rq-pieces" error={fe.piecesCount}>
            <Input id="rq-pieces" name="piecesCount" type="number" min={1} max={999} />
          </Field>
          <Field label="Prazo desejado" htmlFor="rq-due" error={fe.desiredDueDate}>
            <Input id="rq-due" name="desiredDueDate" type="date" />
          </Field>
          <Field label="Prioridade" htmlFor="rq-priority">
            <NativeSelect id="rq-priority" name="priority" defaultValue="medium">
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {template?.fields.length ? (
            <div className="grid gap-4 border-t border-border pt-4 sm:col-span-2 sm:grid-cols-2">
              <p className="text-xs font-medium text-fg-subtle uppercase sm:col-span-2">{template.name}</p>
              {template.fields.map((field) => (
                <div
                  key={field.key}
                  className={field.type === "textarea" || field.type === "multiselect" ? "sm:col-span-2" : ""}
                >
                  <BriefingFieldInput
                    field={field}
                    value={answers[field.key]}
                    onChange={(v) => setAnswers((a) => ({ ...a, [field.key]: v }))}
                    error={fe[`briefing.${field.key}`]?.[0]}
                  />
                </div>
              ))}
            </div>
          ) : null}
          <Field
            label="Referências"
            htmlFor="rq-refs"
            className="sm:col-span-2"
            hint="Links ou descrição de peças que servem de inspiração."
          >
            <Textarea id="rq-refs" name="references" rows={2} />
          </Field>
          <Field
            label="Textos"
            htmlFor="rq-copy"
            className="sm:col-span-2"
            hint="Textos que devem aparecer nas peças, se já existirem."
          >
            <Textarea id="rq-copy" name="copyText" rows={3} />
          </Field>
          <p className="text-xs text-fg-muted sm:col-span-2">
            Arquivos de apoio podem ser anexados logo depois de criar a solicitação.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        {allowDraft ? (
          <Button
            type="button"
            variant="secondary"
            disabled={create.pending}
            onClick={(e) => {
              const form = (e.currentTarget as HTMLButtonElement).form;
              if (form) submit(form, true);
            }}
          >
            Salvar rascunho
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={create.pending}>
          <Send /> Enviar solicitação
        </Button>
      </div>
    </form>
  );
}
