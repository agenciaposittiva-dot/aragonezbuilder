"use client";

import { ArrowDown, ArrowUp, Check, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import type { AiSelection } from "@/lib/ai-select";
import { CONVERT_TARGET_LABEL, type ConversionProposal, type ConvertTarget } from "@/lib/preview-convert";
import type { NetworkKey, PlacementKey } from "@/lib/social-specs";
import {
  automaticConversionAction,
  convertPreviewAction,
  createConvertedContentAction,
  reviewPreviewAction,
  savePreviewTextsAction,
} from "@/server/actions/content-preview";
import type { AiPickerData } from "@/server/services/ai-models";

const needsConfirm = (r: { ok: boolean; code?: string; error?: string }) =>
  !r.ok && r.code === "conflict" && /Confirme para continuar/.test(r.error ?? "");

const AREA_LABEL: Record<string, string> = {
  composicao: "Composição",
  hierarquia: "Hierarquia",
  legenda: "Legenda",
  consistencia: "Consistência",
  formato: "Formato",
};

type Review = {
  summary: string;
  suggestions: { area: string; page: string | null; text: string }[];
  caption: string | null;
};

/**
 * Sugestões da IA para a peça. Nada muda sozinho: a legenda sugerida só
 * entra se a pessoa aplicar, e a conversão é um rascunho editável que vira
 * uma peça NOVA (a original fica como está).
 */
export function AiPanel({
  contentId,
  designId,
  format,
  network,
  placement,
  picker,
  canWrite,
  onShowPage,
}: {
  contentId: string | null;
  designId: string | null;
  format: string | null;
  network: NetworkKey;
  placement: PlacementKey;
  picker: AiPickerData | null;
  canWrite: boolean;
  onShowPage: (label: string) => void;
}) {
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [review, setReview] = useState<(Review & { demo: boolean }) | null>(null);
  const [cost, setCost] = useState<{ kind: "review" | "convert"; message: string } | null>(null);
  const [target, setTarget] = useState<ConvertTarget>(format === "carousel" ? "stories" : "carousel");
  const [draft, setDraft] = useState<{ proposal: ConversionProposal; source: "ai" | "auto"; demo: boolean } | null>(
    null,
  );
  const [captionOpen, setCaptionOpen] = useState(false);

  const reviewAction = useOrgAction(reviewPreviewAction);
  const convertAction = useOrgAction(convertPreviewAction);
  const autoAction = useOrgAction(automaticConversionAction, {
    onSuccess: (proposal) => setDraft({ proposal, source: "auto", demo: false }),
  });
  const applyCaption = useOrgAction(savePreviewTextsAction, {
    success: "Legenda atualizada (a anterior fica registrada no histórico)",
    onSuccess: () => {
      setCaptionOpen(false);
      setReview((r) => (r ? { ...r, caption: null } : r));
    },
  });

  async function runReview(confirmCost?: boolean) {
    setCost(null);
    const r = await reviewAction.run({
      contentId: contentId ?? undefined,
      designId: contentId ? undefined : (designId ?? undefined),
      network,
      placement,
      selection,
      confirmCost,
    });
    if (needsConfirm(r)) return setCost({ kind: "review", message: (r as { error: string }).error });
    if (r.ok) setReview({ ...r.data.review, demo: r.data.demo });
  }

  async function runConvert(confirmCost?: boolean) {
    if (!contentId) return;
    setCost(null);
    const r = await convertAction.run({ contentId, target, selection, confirmCost });
    if (needsConfirm(r)) return setCost({ kind: "convert", message: (r as { error: string }).error });
    if (r.ok) setDraft({ proposal: r.data.proposal, source: "ai", demo: r.data.demo });
  }

  return (
    <div className="grid gap-5" data-testid="preview-ai">
      {picker ? (
        <AiModelPicker
          providers={picker.providers}
          preferences={picker.preferences}
          task="copy"
          module="preview"
          value={selection}
          onChange={setSelection}
          disabled={reviewAction.pending || convertAction.pending}
        />
      ) : (
        <p className="text-xs text-fg-muted">
          Seu papel não tem acesso à IA. A conversão automática continua disponível.
        </p>
      )}

      {cost ? (
        <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          <p>{cost.message}</p>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => (cost.kind === "review" ? runReview(true) : runConvert(true))}
            >
              Confirmar e continuar
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setCost(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Revisão da peça</h3>
        <p className="text-xs text-fg-muted">
          Composição, hierarquia visual, legenda e consistência entre arte e texto. São só sugestões.
        </p>
        {picker ? (
          <Button
            size="sm"
            onClick={() => void runReview()}
            loading={reviewAction.pending}
            className="justify-self-start"
          >
            <Sparkles /> Revisar com IA
          </Button>
        ) : null}
        {review ? (
          <div
            className="grid gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[13px]"
            data-testid="ai-review"
          >
            {review.demo ? <Badge tone="warning">Demonstração: resposta de exemplo</Badge> : null}
            <p>{review.summary}</p>
            <ul className="grid gap-1.5">
              {review.suggestions.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <Badge tone="outline" className="shrink-0">
                    {AREA_LABEL[s.area] ?? s.area}
                  </Badge>
                  <span>
                    {s.text}
                    {s.page ? (
                      <button
                        type="button"
                        className="ml-1 text-xs text-accent-text hover:underline"
                        onClick={() => onShowPage(s.page!)}
                      >
                        ({s.page})
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {review.caption && contentId && canWrite ? (
              <div className="grid gap-2 border-t border-border pt-2">
                <p className="text-xs font-medium">Legenda sugerida</p>
                <p className="text-xs whitespace-pre-wrap text-fg-muted">{review.caption}</p>
                <div className="flex gap-2">
                  <Button size="xs" variant="secondary" onClick={() => setCaptionOpen(true)}>
                    <Check /> Usar esta legenda
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setReview({ ...review, caption: null })}>
                    Descartar
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {contentId && canWrite ? (
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Adaptar para outro formato</h3>
          <p className="text-xs text-fg-muted">
            Gera um rascunho editável. Ao aceitar, nasce uma peça nova com artes novas — a original não muda.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Converter em" htmlFor="preview-convert-target" className="min-w-40">
              <NativeSelect
                id="preview-convert-target"
                value={target}
                onChange={(e) => setTarget(e.target.value as ConvertTarget)}
              >
                {(Object.keys(CONVERT_TARGET_LABEL) as ConvertTarget[])
                  .filter((t) => t !== format)
                  .map((t) => (
                    <option key={t} value={t}>
                      {CONVERT_TARGET_LABEL[t]}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            {picker ? (
              <Button size="sm" onClick={() => void runConvert()} loading={convertAction.pending}>
                <Sparkles /> Rascunho com IA
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void autoAction.run({ contentId, target })}
              loading={autoAction.pending}
            >
              <Wand2 /> Rascunho automático
            </Button>
          </div>
        </section>
      ) : null}

      {captionOpen && review?.caption && contentId ? (
        <Dialog open onOpenChange={(v) => (!v ? setCaptionOpen(false) : null)}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>Trocar a legenda da peça?</DialogTitle>
              <DialogDescription>
                A legenda atual é substituída pela sugerida. Você pode editar de novo depois.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <p className="max-h-60 overflow-y-auto rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">
                {review.caption}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCaptionOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={applyCaption.pending}
                onClick={() => void applyCaption.run({ contentId, caption: review.caption! })}
              >
                Aplicar legenda
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {draft && contentId ? (
        <ConversionDialog contentId={contentId} target={target} draft={draft} onClose={() => setDraft(null)} />
      ) : null}
    </div>
  );
}

function ConversionDialog({
  contentId,
  target,
  draft,
  onClose,
}: {
  contentId: string;
  target: ConvertTarget;
  draft: { proposal: ConversionProposal; source: "ai" | "auto"; demo: boolean };
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const [p, setP] = useState<ConversionProposal>(draft.proposal);
  const [created, setCreated] = useState<{ id: string; designId: string } | null>(null);
  const create = useOrgAction(createConvertedContentAction, {
    success: "Nova versão criada; a peça original foi mantida",
    onSuccess: (r) => setCreated(r),
  });
  const max = target === "feed" ? 1 : 10;
  const setSlide = (i: number, patch: Partial<{ title: string; text: string }>) =>
    setP((x) => ({ ...x, slides: x.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: number) =>
    setP((x) => {
      const slides = [...x.slides];
      const [s] = slides.splice(i, 1);
      slides.splice(i + d, 0, s!);
      return { ...x, slides };
    });

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent size="lg">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            const slides = p.slides.filter((s) => s.title.trim() || s.text.trim());
            if (!slides.length) return void toast.error("Inclua pelo menos uma página com texto.");
            void create.run({ ...p, slides, contentId, target });
          }}
        >
          <DialogHeader>
            <DialogTitle>Rascunho: {CONVERT_TARGET_LABEL[target]}</DialogTitle>
            <DialogDescription>
              {draft.source === "ai"
                ? draft.demo
                  ? "Rascunho de exemplo do modo demonstração."
                  : "Rascunho sugerido pela IA."
                : "Rascunho montado automaticamente com os textos da peça (sem IA)."}{" "}
              Revise antes de criar: a peça original não é alterada.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            {created ? (
              <div
                className="grid gap-2 rounded-lg border border-success/40 bg-success-soft p-3 text-sm"
                data-testid="conversion-created"
              >
                <p>Nova peça criada em rascunho, com arte editável.</p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="primary">
                    <Link href={`/w/${ws.orgSlug}/content/${created.id}/preview`}>Ver prévia da nova versão</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href={`/w/${ws.orgSlug}/studio/${created.designId}`}>Abrir arte no editor</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Field label="Título" htmlFor="conv-title">
                  <Input
                    id="conv-title"
                    value={p.title}
                    maxLength={200}
                    onChange={(e) => setP({ ...p, title: e.target.value })}
                    required
                  />
                </Field>
                <ol className="grid gap-2" aria-label="Páginas">
                  {p.slides.map((s, i) => (
                    <li key={i} className="grid gap-1.5 rounded-lg border border-border p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-fg-muted">
                          {target === "stories" ? "Tela" : "Página"} {i + 1}
                        </span>
                        <div className="flex gap-0.5">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Subir"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Descer"
                            disabled={i === p.slides.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="danger-ghost"
                            aria-label="Remover página"
                            disabled={p.slides.length === 1}
                            onClick={() => setP({ ...p, slides: p.slides.filter((_, j) => j !== i) })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      <Input
                        aria-label={`Título da página ${i + 1}`}
                        value={s.title}
                        maxLength={200}
                        onChange={(e) => setSlide(i, { title: e.target.value })}
                      />
                      <Textarea
                        aria-label={`Texto da página ${i + 1}`}
                        rows={2}
                        value={s.text}
                        maxLength={1200}
                        onChange={(e) => setSlide(i, { text: e.target.value })}
                      />
                    </li>
                  ))}
                </ol>
                {p.slides.length < max ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="justify-self-start"
                    onClick={() => setP({ ...p, slides: [...p.slides, { title: "", text: "" }] })}
                  >
                    <Plus /> Adicionar página
                  </Button>
                ) : null}
                <Field label="Legenda" htmlFor="conv-caption">
                  <Textarea
                    id="conv-caption"
                    rows={4}
                    maxLength={4000}
                    value={p.caption ?? ""}
                    onChange={(e) => setP({ ...p, caption: e.target.value })}
                  />
                </Field>
                <Field label="Chamada para ação" htmlFor="conv-cta">
                  <Input
                    id="conv-cta"
                    maxLength={300}
                    value={p.cta ?? ""}
                    onChange={(e) => setP({ ...p, cta: e.target.value })}
                  />
                </Field>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {created ? "Fechar" : "Descartar rascunho"}
            </Button>
            {!created ? (
              <Button type="submit" variant="primary" loading={create.pending}>
                Criar nova versão
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
